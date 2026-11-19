// The per-item Start state machine (design D3). States live in storage under the connection id,
// so a double press, a second panel or a worker restart never creates a second workspace.
import type { OrcaWorkerApi } from 'orca/worker'
import { type Connections, keyOf } from './connection'
import type { Items } from './items'
import { linkedWorkspace } from './links'
import type { Attempt, StartState } from './protocol'
import { workspaceName } from './start'
import { env } from './plane/http'

type States = Record<string, StartState>
/** Earlier Starts per item key, oldest first (design H1 of start-history). */
type History = Record<string, Attempt[]>
type Outcome = Extract<StartState, { kind: 'created' | 'failed' | 'unknown' }>

const KEEP_PER_ITEM = 10
const KEEP_ITEMS = 50
/** Orca refuses a storage value over 256 KiB; the history stays well under it. */
const MAX_BYTES = 200 * 1024

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/**
 * Appends an attempt, keeping the item's last 10 and the 50 items started most recently, then drops
 * the oldest items while the value is over 200 KiB, never the newest (H4). Changes `history`.
 */
export function append(history: History, key: string, attempt: Attempt): void {
  history[key] = [...(history[key] ?? []), attempt].slice(-KEEP_PER_ITEM)
  const newest = (item: string) => history[item].at(-1)?.at ?? 0
  // The item just appended counts as the newest, whatever its clock says.
  const older = Object.keys(history)
    .filter((item) => item !== key)
    .sort((a, b) => newest(b) - newest(a))
  for (const item of older.splice(KEEP_ITEMS - 1)) delete history[item]
  while (older.length > 0 && bytes(history) > MAX_BYTES) delete history[older.pop()!]
}

/** Sets the outcome of the item's attempt `id`; a no-op when it has it already or was dropped. Changes `history`. */
export function settle(history: History, key: string, id: string, outcome: Attempt['outcome']): void {
  const attempt = history[key]?.find((entry) => entry.id === id)
  if (attempt) attempt.outcome = outcome
}
type Row = { id: string; name: string; projectId?: string | null }

// Host errors that say the create was refused before anything happened.
const REFUSED = new Set([
  'invalid_request',
  'invalid_params',
  'unknown_method',
  'capability_denied',
  'consent_required',
  'not_permitted',
  'conflict',
  'too_large',
  'action_failed'
])

export type StartInput = {
  key: string
  orcaProjectId: string
  hostId: string | null
  agent: string | null
  prompt: string
}

export class Starts {
  private lock: Promise<unknown> = Promise.resolve()
  private listeners: ((states: States) => void)[] = []

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly conns: Connections,
    private readonly items: Items
  ) {}

  /** Hears the states after every write, inside the connection lock: a listener must not wait on Starts. */
  onWrite(listener: (states: States) => void): void {
    this.listeners.push(listener)
  }

  /**
   * Runs `change` on the stored states and history one at a time; writes only if the connection is the same.
   * With `since`, does nothing unless the connection is still the one of that generation.
   */
  private mutate<T>(change: (states: States, history: History) => Promise<T> | T, since?: number): Promise<T | null> {
    const run = this.lock.then(async () => {
      const generation = this.conns.generation
      const conn = await this.conns.current()
      if (!conn || (since !== undefined && since !== generation)) return null
      const saved = await this.orca.storage.get(keyOf(conn.id, 'starts'))
      const states: States = saved && typeof saved === 'object' ? { ...(saved as States) } : {}
      const before = { ...states }
      const kept = await this.orca.storage.get(keyOf(conn.id, 'history'))
      const historyBefore = JSON.stringify(kept && typeof kept === 'object' ? kept : {})
      const history: History = JSON.parse(historyBefore)
      const result = await change(states, history)
      await this.conns.whileCurrent(generation, async () => {
        const old: History = JSON.parse(historyBefore)
        // History first (design H2); a failed write loses only the attempt, and the Start goes on.
        if (JSON.stringify(history) !== historyBefore) {
          await this.orca.storage.set(keyOf(conn.id, 'history'), history).catch(() => undefined)
        }
        await this.orca.storage.set(keyOf(conn.id, 'starts'), states)
        // Every state or history a write changed or dropped (idle) reaches open panels, reconciles included.
        for (const key of new Set([...Object.keys(before), ...Object.keys(states), ...Object.keys(history), ...Object.keys(old)])) {
          const state = states[key] ?? { kind: 'idle' }
          const moved = JSON.stringify(state) !== JSON.stringify(before[key] ?? { kind: 'idle' })
          if (moved || JSON.stringify(history[key]) !== JSON.stringify(old[key])) this.changed(key, state)
        }
        for (const listener of this.listeners) listener({ ...states })
      })
      return result
    })
    this.lock = run.catch(() => undefined)
    return run
  }

  private changed(key: string, state: StartState): void {
    this.orca.panels.post('start.changed', { key, state })
  }

  /** On worker start: a create that was running when the worker stopped has an unknown outcome. */
  recover(): Promise<unknown> {
    return this.mutate((states, history) => {
      for (const [key, state] of Object.entries(states)) {
        if (state.kind === 'pending') states[key] = { kind: 'unknown', name: state.name, projectId: state.projectId }
      }
      for (const attempt of Object.values(history).flat()) if (attempt.outcome === 'pending') attempt.outcome = 'unknown'
    })
  }

  private async workspaces(): Promise<{ workspaces: Row[]; truncated: boolean } | null> {
    try {
      return await this.orca.host.call('workspace.list')
    } catch {
      return null
    }
  }

  // limit: matches a workspace by id, or by name in its project, until the id `workspace.create`
  // returns is confirmed to be the one `workspace.list` gives (task 5.4).
  private static find(rows: Row[], projectId: string, name: string, workspaceId?: string): Row | undefined {
    return rows.find((row) => row.id === workspaceId || (row.projectId === projectId && row.name === name))
  }

  /**
   * Resolves `unknown` states and attempts by name, and drops links whose workspace is gone. Changes
   * `states` and `history`. A truncated list proves only the rows it has: a link or an outcome it lacks is kept.
   */
  private async reconcile(states: States, history: History, only?: string): Promise<void> {
    const keys = Object.keys(states).filter((key) => (only === undefined || key === only) && states[key].kind !== 'pending')
    // Each attempt by its own project and name (H3): it needs no state, which may be gone or never written.
    const open = Object.entries(history)
      .filter(([key]) => only === undefined || key === only)
      .flatMap(([, attempts]) => attempts.filter((attempt) => attempt.outcome === 'unknown'))
    if (!keys.some((key) => ['unknown', 'created', 'failed'].includes(states[key].kind)) && open.length === 0) return
    const list = await this.workspaces()
    if (!list) return
    const rows = list.workspaces
    const complete = !list.truncated
    for (const attempt of open) {
      if (Starts.find(rows, attempt.projectId, attempt.workspace)) attempt.outcome = 'created'
      else if (complete) attempt.outcome = 'failed'
    }
    for (const key of keys) {
      const state = states[key]
      if (state.kind === 'unknown') {
        const row = Starts.find(rows, state.projectId, state.name)
        if (row) states[key] = { kind: 'created', workspaceId: row.id, name: state.name, projectId: state.projectId }
        else if (complete) delete states[key]
      } else if (complete && state.kind === 'created' && !Starts.find(rows, state.projectId, state.name, state.workspaceId)) {
        delete states[key]
      } else if (complete && state.kind === 'failed' && state.workspaceId && !rows.some((row) => row.id === state.workspaceId)) {
        delete states[key]
      }
    }
  }

  async all(): Promise<States> {
    return (await this.mutate(async (states, history) => {
      await this.reconcile(states, history)
      return { ...states }
    })) ?? {}
  }

  /** The item's earlier Starts, oldest first. */
  async history(key: string): Promise<Attempt[]> {
    const conn = await this.conns.current()
    if (!conn) return []
    const kept = await this.orca.storage.get(keyOf(conn.id, 'history'))
    return (kept && typeof kept === 'object' ? (kept as History)[key] : undefined) ?? []
  }

  private async projectName(id: string): Promise<string> {
    try {
      const { projects } = await this.orca.host.call('project.list')
      return projects.find((project) => project.id === id)?.name ?? id
    } catch {
      return id
    }
  }

  /** Orca removed this workspace: drop every link to it, which needs no (possibly truncated) list. */
  async dropWorkspace(ids: string[]): Promise<void> {
    await this.mutate((states) => {
      for (const [key, state] of Object.entries(states)) {
        const workspaceId = linkedWorkspace(state)
        if (workspaceId && ids.includes(workspaceId)) delete states[key]
      }
    })
  }

  async start(input: StartInput): Promise<{ accepted: true } | { accepted: false; reason: string }> {
    const generation = this.conns.generation
    const item = (await this.items.state()).items.find((entry) => entry.key === input.key)
    if (!item) return { accepted: false, reason: 'This item is not in your list; refresh and try again.' }
    if (!input.orcaProjectId) return { accepted: false, reason: 'Pick a project.' }
    const name = workspaceName(item.key, item.title)
    const project = await this.projectName(input.orcaProjectId)
    const verdict = await this.mutate(async (states, history) => {
      await this.reconcile(states, history, input.key)
      const state = states[input.key]
      if (state?.kind === 'pending') return { reason: 'A start for this item is already running.' }
      if (state?.kind === 'unknown') {
        return { reason: 'Orca has not confirmed whether the last start created a workspace. Try again shortly.' }
      }
      if (state?.kind === 'created' || (state?.kind === 'failed' && state.workspaceId)) {
        return { reason: 'This item already has a workspace: open it instead.' }
      }
      const at = env.now()
      // Not the time: a clock can repeat a reading, and the id must name one attempt only.
      const id = crypto.randomUUID()
      append(history, input.key, { id, at, agent: input.agent, project, projectId: input.orcaProjectId, workspace: name, outcome: 'pending' })
      states[input.key] = { kind: 'pending', name, projectId: input.orcaProjectId, startedAt: at }
      return { reason: null, id }
    }, generation)
    if (!verdict || generation !== this.conns.generation) return { accepted: false, reason: 'Not connected to Plane.' }
    if (verdict.reason !== null) return { accepted: false, reason: verdict.reason }
    void this.create(input, name, verdict.id, generation)
    return { accepted: true }
  }

  private async create(input: StartInput, name: string, id: string, generation: number): Promise<void> {
    let outcome: Outcome
    try {
      const created = await this.orca.host.call('workspace.create', {
        projectId: input.orcaProjectId,
        ...(input.hostId ? { hostId: input.hostId } : {}),
        name,
        ...(input.agent ? { agent: input.agent, prompt: input.prompt } : {})
      })
      outcome = { kind: 'created', workspaceId: created.workspaceId, name, projectId: input.orcaProjectId }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Start failed.'
      const code = (error as { code?: unknown } | null)?.code
      const list = await this.workspaces()
      const row = list && Starts.find(list.workspaces, input.orcaProjectId, name)
      if (row) outcome = { kind: 'failed', error: message, workspaceId: row.id }
      // action_failed can come after the workspace exists: only a complete list proves it does not.
      else if (list && !list.truncated && typeof code === 'string' && REFUSED.has(code)) outcome = { kind: 'failed', error: message }
      else outcome = { kind: 'unknown', name, projectId: input.orcaProjectId }
    }
    await this.mutate((states, history) => {
      states[input.key] = outcome
      settle(history, input.key, id, outcome.kind)
    }, generation)
  }
}
