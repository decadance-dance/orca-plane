// The per-item Start state machine (design D3). States live in storage under the connection id,
// so a double press, a second panel or a worker restart never creates a second workspace.
import type { OrcaWorkerApi } from 'orca/worker'
import { type Connections, keyOf } from './connection'
import type { Items } from './items'
import { linkedWorkspace } from './links'
import type { StartState } from './protocol'
import { workspaceName } from './start'
import { env } from './plane/http'

type States = Record<string, StartState>
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
  // Branch of each Start create in flight, by project and workspace name (design B1).
  private readonly creating = new Map<string, string>()

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
   * Runs `change` on the stored states one at a time; writes only if the connection is the same.
   * With `since`, does nothing unless the connection is still the one of that generation.
   */
  private mutate<T>(change: (states: States) => Promise<T> | T, since?: number): Promise<T | null> {
    const run = this.lock.then(async () => {
      const generation = this.conns.generation
      const conn = await this.conns.current()
      if (!conn || (since !== undefined && since !== generation)) return null
      const saved = await this.orca.storage.get(keyOf(conn.id, 'starts'))
      const states: States = saved && typeof saved === 'object' ? { ...(saved as States) } : {}
      const before = { ...states }
      const result = await change(states)
      await this.conns.whileCurrent(generation, async () => {
        await this.orca.storage.set(keyOf(conn.id, 'starts'), states)
        // Every state a write changed or dropped (idle) reaches open panels, reconciles included.
        for (const key of new Set([...Object.keys(before), ...Object.keys(states)])) {
          const state = states[key] ?? { kind: 'idle' }
          if (JSON.stringify(state) !== JSON.stringify(before[key] ?? { kind: 'idle' })) this.changed(key, state)
        }
        for (const listener of this.listeners) listener({ ...states })
      })
      return result
    })
    this.lock = run.catch(() => undefined)
    return run
  }

  /** The branch for a create that is this plugin's Start in flight; read by the create hook. */
  branchFor(projectId: string, name: string): string | undefined {
    return this.creating.get(`${projectId}\n${name}`)
  }

  private changed(key: string, state: StartState): void {
    this.orca.panels.post('start.changed', { key, state })
  }

  /** On worker start: a create that was running when the worker stopped has an unknown outcome. */
  recover(): Promise<unknown> {
    return this.mutate((states) => {
      for (const [key, state] of Object.entries(states)) {
        if (state.kind === 'pending') states[key] = { kind: 'unknown', name: state.name, projectId: state.projectId }
      }
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
   * Resolves `unknown` by name, and drops links whose workspace is gone. Changes `states`.
   * A truncated list proves only the rows it has: a link or an outcome it lacks is kept.
   */
  private async reconcile(states: States, only?: string): Promise<void> {
    const keys = Object.keys(states).filter((key) => (only === undefined || key === only) && states[key].kind !== 'pending')
    if (!keys.some((key) => ['unknown', 'created', 'failed'].includes(states[key].kind))) return
    const list = await this.workspaces()
    if (!list) return
    const rows = list.workspaces
    const complete = !list.truncated
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
    return (await this.mutate(async (states) => {
      await this.reconcile(states)
      return { ...states }
    })) ?? {}
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
    const verdict = await this.mutate(async (states) => {
      await this.reconcile(states, input.key)
      const state = states[input.key]
      if (state?.kind === 'pending') return { reason: 'A start for this item is already running.' }
      if (state?.kind === 'unknown') {
        return { reason: 'Orca has not confirmed whether the last start created a workspace. Try again shortly.' }
      }
      if (state?.kind === 'created' || (state?.kind === 'failed' && state.workspaceId)) {
        return { reason: 'This item already has a workspace: open it instead.' }
      }
      states[input.key] = { kind: 'pending', name, projectId: input.orcaProjectId, startedAt: env.now() }
      return { reason: null }
    }, generation)
    if (!verdict || generation !== this.conns.generation) return { accepted: false, reason: 'Not connected to Plane.' }
    if (verdict.reason !== null) return { accepted: false, reason: verdict.reason }
    void this.create(input, name, generation)
    return { accepted: true }
  }

  private async create(input: StartInput, name: string, generation: number): Promise<void> {
    let outcome: StartState
    const slot = `${input.orcaProjectId}\n${name}`
    // The branch is the workspace name; host workspace.create takes no branch, so the hook sets it.
    this.creating.set(slot, name)
    try {
      const created = await this.orca.host
        .call('workspace.create', {
          projectId: input.orcaProjectId,
          ...(input.hostId ? { hostId: input.hostId } : {}),
          name,
          ...(input.agent ? { agent: input.agent, prompt: input.prompt } : {})
        })
        .finally(() => this.creating.delete(slot))
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
    await this.mutate((states) => {
      states[input.key] = outcome
    }, generation)
  }
}
