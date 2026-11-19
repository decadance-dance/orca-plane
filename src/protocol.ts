// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
// Nothing here carries the token back to a panel: only `connection.connect` takes it in.
import type { Item, ItemDetail } from './plane/map'

export type ConnectionStatus =
  | { connected: false }
  | { connected: true; hostKind: 'cloud' | 'self-hosted'; server: string; slug: string; userName: string }

export type ConnectInput = {
  hostKind: 'cloud' | 'self-hosted'
  /** Ignored for Cloud. */
  serverUrl: string
  slug: string
  token: string
}

/** null: nothing loaded yet. */
export type Completeness = 'complete' | 'partial' | 'stale' | 'error'

export type ItemsState = {
  items: Item[]
  completeness: Completeness | null
  /** Epoch ms of the last successful refresh. */
  fetchedAt: number | null
  error: string | null
  refreshing: boolean
}

export type StartState =
  | { kind: 'idle' }
  | { kind: 'pending'; name: string; projectId: string; startedAt: number }
  | { kind: 'created'; workspaceId: string; name: string; projectId: string }
  /** `name` is kept when the workspace exists (closed-item-workspaces C3); links saved earlier lack it. */
  | { kind: 'failed'; error: string; workspaceId?: string; name?: string }
  | { kind: 'unknown'; name: string; projectId: string }

/** One Start of an item as the history keeps it (design H1 of start-history); `id` is unique, `at` is its `startedAt`. */
export type Attempt = {
  id: string
  at: number
  agent: string | null
  project: string
  projectId: string
  workspace: string
  outcome: 'pending' | 'created' | 'failed' | 'unknown'
}

/** The agent state of a linked workspace: Orca's blocked and waiting are both `needs-input`. */
export type AgentState = 'working' | 'needs-input' | 'done'

/** A linked item's workspace and its agent's latest state; null when none was reported since the worker started. */
export type LinkView = { workspaceId: string; agent: AgentState | null }

export type OrcaProject = { id: string; name: string; hostId: string | null }

export type AgentChoice = { value: string; label: string }

/** The agents Start knows, as Orca agent ids with the command that runs each (design D8). */
export const KNOWN_AGENTS = [
  { value: 'claude', label: 'Claude Code', command: 'claude' },
  { value: 'codex', label: 'Codex', command: 'codex' },
  { value: 'gemini', label: 'Gemini', command: 'gemini' },
  { value: 'opencode', label: 'OpenCode', command: 'opencode' },
  { value: 'cursor', label: 'Cursor', command: 'cursor-agent' },
  { value: 'copilot', label: 'GitHub Copilot', command: 'copilot' },
  { value: 'qwen-code', label: 'Qwen Code', command: 'qwen' },
  { value: 'droid', label: 'Droid', command: 'droid' },
  { value: 'kimi', label: 'Kimi', command: 'kimi' }
] as const

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

declare module 'orca' {
  interface PluginRequests {
    'connection.get': { output: ConnectionStatus }
    /** Validates against the server before it saves anything. */
    'connection.connect': { input: ConnectInput; output: Result<{ status: ConnectionStatus }> }
    'connection.disconnect': { output: ConnectionStatus }
    /** Answers from the cache at once; refreshes in the background when old or `force`. */
    'items.list': { input: { force?: boolean } | undefined; output: ItemsState }
    /** `projectId` is the Plane project; without it the item is fetched by its key alone. */
    'item.get': { input: { key: string; projectId?: string }; output: Result<{ item: ItemDetail }> }
    /** Opens any item of the workspace by a typed key or a pasted Plane URL; a refused text sends no request. */
    'item.lookup': { input: { text: string }; output: Result<{ item: ItemDetail }> }
    /** Every item's Start state that is not idle, reconciled with Orca's workspaces, and the linked
     *  keys hidden from the section of items no longer open. */
    'starts.get': { output: { states: Record<string, StartState>; hidden: string[] } }
    /** Hides a linked item from that section; its link stays. Open panels also hear it as `start.changed`. */
    'start.hide': { input: { key: string }; output: { ok: true } }
    /** The item's earlier Starts, oldest first; empty when it has none or nothing is connected. */
    'history.get': { input: { key: string }; output: Attempt[] }
    /** Every linked item (key) with its workspace and agent state. */
    'links.get': { output: Record<string, LinkView> }
    /** Answers at once; the outcome arrives as `start.changed`. `agent` null starts no agent. */
    'item.start': {
      input: { key: string; orcaProjectId: string; hostId: string | null; agent: string | null; prompt: string; name: string }
      output: { accepted: true } | { accepted: false; reason: string }
    }
    /** The known agents found on this computer; all of them when none is found. */
    'agents.installed': { output: { agents: AgentChoice[] } }
    /** Orca's Git projects, the only ones Start can use. */
    'orca.projects': { output: { projects: OrcaProject[] } }
    'workspace.open': { input: { workspaceId: string }; output: Result<{}> }
  }
  interface PluginPanelEvents {
    'connection.changed': ConnectionStatus
    'items.changed': ItemsState
    /** `hidden`: the item is hidden from the section of items no longer open. */
    'start.changed': { key: string; state: StartState; hidden: boolean }
    'links.changed': Record<string, LinkView>
    /** The focused Orca workspace now belongs to this item (null: to none). */
    'focus.changed': { key: string | null }
  }
}
