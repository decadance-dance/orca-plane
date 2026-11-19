// Item <-> workspace links and the agent state of each linked workspace (design L1, L2, L4).
// The links come from the Start states; agent states live in memory only, from Orca's events.
// The hooks of agent-item-context (A1, A3, A4) read the item of a terminal or a launch from here.
import type { PluginEvents } from 'orca'
import type { OrcaWorkerApi } from 'orca/worker'
import { browseUrl } from './plane/url'
import type { AgentState, LinkView, StartState } from './protocol'

type Agent = { state: AgentState; since: number }
/** An item for the hooks: its key and Plane URL, never ticket text (A2). */
export type ItemRef = { key: string; url: string }

/** The workspace a Start state links its item to, if any. */
export function linkedWorkspace(state: StartState): string | undefined {
  return state.kind === 'created' || state.kind === 'failed' ? state.workspaceId : undefined
}

/** Every id an event names a workspace by. The live probe (test/fixtures/orca-ids.json) shows
 *  `workspaceListId` equal to the id `workspace.create` returns, and `workspaceId` a different form. */
export function idsOf(event: { workspaceId?: string | null; workspaceListId?: string }): string[] {
  return [event.workspaceListId, event.workspaceId].filter((id): id is string => typeof id === 'string' && id !== '')
}

export class Links {
  /** workspaceId -> item key. */
  private keys = new Map<string, string>()
  /** Per workspace id, also before (or without) a link: an event can come before the Start outcome. */
  private agents = new Map<string, Agent>()
  /** terminalId -> the ids its workspace carried. */
  private terminals = new Map<string, string[]>()
  private lastFocus: { workspaceId: string | null; key: string | null } | null = null
  private snapshot = '{}'
  /** The connection's app base and slug, for item URLs (A1). */
  private base: { appBase: string; slug: string } | null = null
  /** Another id form of a workspace -> the id `workspace.list` gives it (A4: the launch hook names only `<projectId>::<path>`), from events. */
  private aliases = new Map<string, string>()
  /** The same from the last `workspace.list` rows; an event's pair wins over it, as the newer fact. */
  private listed = new Map<string, string>()
  /** `<projectId>::<path>` forms of removed workspaces: a path can be reused, so from then on only `workspace.created` pairs it (A4). */
  private fenced = new Set<string>()
  /** Whether the last `workspace.list` for the id pairs failed, so the next seed lists again. */
  private listAgain = false
  /** Links handed over by `Starts` when `workspace.create` returns, until the Start state stores them (A4). */
  private adopted = new Map<string, string>()
  /** Linked workspaces whose terminals were listed once (A3). */
  private seeded = new Set<string>()

  constructor(
    private readonly notify: {
      /** The links changed: every linked item with its agent state, and how many agents need input. */
      changed(links: Record<string, LinkView>, waiting: number): void
      /** The focused workspace now resolves to another item, or to none. */
      focus(key: string | null): void
    }
  ) {}

  /** Replaces the links with those of the Start states. */
  set(states: Record<string, StartState>): void {
    this.keys = new Map()
    for (const [key, state] of Object.entries(states)) {
      const workspaceId = linkedWorkspace(state)
      if (workspaceId) this.keys.set(workspaceId, key)
    }
    // A handed-over link stays until its outcome is written; then the stored state decides.
    for (const [workspaceId, key] of this.adopted) if (states[key]?.kind !== 'pending') this.adopted.delete(workspaceId)
    this.publish()
  }

  /**
   * On a connection change: the old account's links go at once; agent states belong to Orca and stay.
   * The focused workspace is kept but its key is not: the new account may link the same key elsewhere.
   */
  clear(): void {
    if (this.lastFocus) this.lastFocus = { workspaceId: this.lastFocus.workspaceId, key: null }
    this.adopted.clear()
    this.set({})
  }

  /** The connection whose links these are; set before its links, on every connection change. */
  connection(conn: { appBase: string; slug: string } | null): void {
    this.base = conn ? { appBase: conn.appBase, slug: conn.slug } : null
  }

  /**
   * A4: a Start's `workspace.create` returned, under the current connection (the caller checks the
   * generation). Hooks see the link at once; the panel waits for the stored outcome.
   */
  adopt(key: string, workspaceId: string, terminalId?: string): void {
    this.adopted.set(workspaceId, key)
    if (terminalId) this.remember(terminalId, [workspaceId])
  }

  /** `workspace.created` names the workspace by both ids; it never links anything by its name or branch. */
  created(event: PluginEvents['workspace.created']): void {
    this.pair(event.workspaceId, event.workspaceListId, true)
  }

  /**
   * A3: lists the terminals of each linked workspace not listed yet, and pairs `workspace.list` rows
   * with their launch id form. Failures are ignored; never called from a hook.
   */
  async seed(host: OrcaWorkerApi['host']): Promise<void> {
    const fresh = [...this.keys.keys(), ...this.adopted.keys()].filter((id) => !this.seeded.has(id))
    if (fresh.length === 0 && !this.listAgain) return
    for (const id of fresh) this.seeded.add(id)
    this.listAgain = false
    try {
      const { workspaces } = await host.call('workspace.list')
      const listed = new Map<string, string>()
      for (const row of workspaces) {
        // limit: Orca does not document the `<projectId>::<path>` form; the live probe
        // (test/fixtures/orca-ids.json) pins it. Only an exact match on it is ever used.
        const other = `${row.projectId}::${row.path}`
        if (row.projectId && row.path) this.pair(other, row.id, false, listed)
      }
      this.listed = listed
    } catch {
      // The events' id pairs still apply; the next seed lists again.
      this.listAgain = true
    }
    await Promise.all(
      fresh.map(async (workspaceId) => {
        try {
          const { terminals } = await host.call('terminal.list', { workspaceId })
          for (const terminal of terminals) this.remember(terminal.id, [workspaceId])
        } catch {
          this.seeded.delete(workspaceId)
        }
      })
    )
  }

  /** The item linked to a terminal's workspace, from memory only (A1). */
  itemOfTerminal(terminalId: string): ItemRef | null {
    return this.item(this.terminals.get(terminalId) ?? [])
  }

  /** The item of an agent launch; also remembers its terminal (A3). From memory only (A1). */
  launch(event: { workspaceId: string | null; terminalId?: string }): ItemRef | null {
    if (event.terminalId && event.workspaceId) this.remember(event.terminalId, [event.workspaceId])
    return this.item([...(event.workspaceId ? [event.workspaceId] : []), ...(event.terminalId ? (this.terminals.get(event.terminalId) ?? []) : [])])
  }

  private item(ids: string[]): ItemRef | null {
    if (!this.base) return null
    for (const id of ids) {
      // A fenced path form resolves only through the pair a later `workspace.created` gave it (A4),
      // also when a Start link is stored under it (Orca's raw-id fallback) and its removal is pending.
      const direct = this.fenced.has(id) ? [] : [id]
      for (const candidate of [...direct, this.aliases.get(id) ?? this.listed.get(id)]) {
        if (candidate === undefined) continue
        const key = this.keys.get(candidate) ?? this.adopted.get(candidate)
        if (key) return { key, url: browseUrl(this.base.appBase, this.base.slug, key) }
      }
    }
    return null
  }

  private remember(terminalId: string, ids: string[]): void {
    this.terminals.set(terminalId, [...new Set([...(this.terminals.get(terminalId) ?? []), ...ids])])
  }

  /**
   * The pair store's one rule (A4): two different ids of one workspace, never a name. Once a
   * `<projectId>::<path>` form is removed, only a `workspace.created` after that removal pairs it;
   * agent status, list rows and anything else for it are ignored, as they may describe the removed one.
   */
  private pair(other: string | null | undefined, stable: string | undefined, created = false, into = this.aliases): void {
    if (other && stable && other !== stable && (created || !this.fenced.has(other))) into.set(other, stable)
  }

  agent(event: PluginEvents['agent.status.changed']): void {
    const ids = idsOf(event)
    if (ids.length === 0) return
    this.pair(event.workspaceId, event.workspaceListId)
    if (event.terminalId) this.remember(event.terminalId, ids)
    // The main agent wins: `state` can come from a sub-pane.
    const raw = event.mainAgent?.state ?? event.state
    const state: AgentState = raw === 'blocked' || raw === 'waiting' ? 'needs-input' : raw
    const previous = ids.map((id) => this.agents.get(id)).find((known) => known !== undefined)
    const since = previous?.state === state ? previous.since : (event.mainAgent?.stateStartedAt ?? event.receivedAt)
    for (const id of ids) this.agents.set(id, { state, since })
    this.publish()
  }

  /** Forgets a removed workspace's agent state at once; Starts drops its link (design L3). Returns every id it knows the workspace by. */
  removed(event: PluginEvents['workspace.removed']): string[] {
    const ids = idsOf(event)
    for (const id of ids) {
      this.agents.delete(id)
      this.adopted.delete(id)
      this.seeded.delete(id)
    }
    // The stable id also when the event names only the other form (`workspaceListId` is optional), for Starts.
    const stable = [event.workspaceListId, ...ids.map((id) => this.aliases.get(id) ?? this.listed.get(id))]
    // Whatever `workspaceListId` says: without an identity id, Orca gives the raw path id in both fields.
    // limit: one entry per removed workspace, kept while the worker runs.
    if (event.workspaceId) this.fenced.add(event.workspaceId)
    for (const pairs of [this.aliases, this.listed]) {
      for (const [other, id] of pairs) if (ids.includes(other) || ids.includes(id)) pairs.delete(other)
    }
    for (const [terminal, of] of this.terminals) if (of.some((id) => ids.includes(id))) this.terminals.delete(terminal)
    this.publish()
    return [...new Set([...ids, ...stable.filter((id): id is string => id !== undefined)])]
  }

  /** L4: posts only when the focused workspace changes to one of another item; the first event only sets it. */
  focus(event: PluginEvents['workspace.changed']): void {
    const workspaceId = event.context?.workspaceId || null
    if (workspaceId) for (const terminal of event.context?.terminals ?? []) this.remember(terminal.id, [workspaceId])
    if (this.lastFocus && this.lastFocus.workspaceId === workspaceId) return
    const key = workspaceId ? this.keyOfWorkspace(workspaceId) : null
    const first = this.lastFocus === null
    const changed = this.lastFocus?.key !== key
    this.lastFocus = { workspaceId, key }
    if (!first && changed) this.notify.focus(key)
  }

  keyOfWorkspace(workspaceId: string): string | null {
    return this.keys.get(workspaceId) ?? null
  }

  /** The workspace a terminal's agent reported from: its linked id when it has one. */
  workspaceOfTerminal(terminalId: string): string | null {
    const ids = this.terminals.get(terminalId)
    return ids?.find((id) => this.keys.has(id)) ?? ids?.[0] ?? null
  }

  byKey(): Record<string, LinkView> {
    const links: Record<string, LinkView> = {}
    for (const [workspaceId, key] of this.keys) links[key] = { workspaceId, agent: this.agents.get(workspaceId)?.state ?? null }
    return links
  }

  /** The linked agents that need input, longest waiting first. */
  waiting(): { key: string; workspaceId: string; since: number }[] {
    const waiting: { key: string; workspaceId: string; since: number }[] = []
    for (const [workspaceId, key] of this.keys) {
      const agent = this.agents.get(workspaceId)
      if (agent?.state === 'needs-input') waiting.push({ key, workspaceId, since: agent.since })
    }
    return waiting.sort((a, b) => a.since - b.since)
  }

  private publish(): void {
    const links = this.byKey()
    const next = JSON.stringify(links)
    if (next === this.snapshot) return
    this.snapshot = next
    this.notify.changed(links, this.waiting().length)
  }
}
