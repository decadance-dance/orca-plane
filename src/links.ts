// Item <-> workspace links and the agent state of each linked workspace (design L1, L2, L4).
// The links come from the Start states; agent states live in memory only, from Orca's events.
import type { PluginEvents } from 'orca'
import type { AgentState, LinkView, StartState } from './protocol'

type Agent = { state: AgentState; since: number }

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
    this.publish()
  }

  /**
   * On a connection change: the old account's links go at once; agent states belong to Orca and stay.
   * The focused workspace is kept but its key is not: the new account may link the same key elsewhere.
   */
  clear(): void {
    if (this.lastFocus) this.lastFocus = { workspaceId: this.lastFocus.workspaceId, key: null }
    this.set({})
  }

  agent(event: PluginEvents['agent.status.changed']): void {
    const ids = idsOf(event)
    if (ids.length === 0) return
    if (event.terminalId) this.terminals.set(event.terminalId, ids)
    // The main agent wins: `state` can come from a sub-pane.
    const raw = event.mainAgent?.state ?? event.state
    const state: AgentState = raw === 'blocked' || raw === 'waiting' ? 'needs-input' : raw
    const previous = ids.map((id) => this.agents.get(id)).find((known) => known !== undefined)
    const since = previous?.state === state ? previous.since : (event.mainAgent?.stateStartedAt ?? event.receivedAt)
    for (const id of ids) this.agents.set(id, { state, since })
    this.publish()
  }

  /** Forgets a removed workspace's agent state at once; Starts drops its link (design L3). */
  removed(event: PluginEvents['workspace.removed']): void {
    const ids = idsOf(event)
    for (const id of ids) this.agents.delete(id)
    for (const [terminal, of] of this.terminals) if (of.some((id) => ids.includes(id))) this.terminals.delete(terminal)
    this.publish()
  }

  /** L4: posts only when the focused workspace changes to one of another item; the first event only sets it. */
  focus(event: PluginEvents['workspace.changed']): void {
    const workspaceId = event.context?.workspaceId || null
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
