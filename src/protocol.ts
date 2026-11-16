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
  | { kind: 'failed'; error: string; workspaceId?: string }
  | { kind: 'unknown'; name: string; projectId: string }

export type OrcaProject = { id: string; name: string; hostId: string | null }

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

declare module 'orca' {
  interface PluginRequests {
    'connection.get': { output: ConnectionStatus }
    /** Validates against the server before it saves anything. */
    'connection.connect': { input: ConnectInput; output: Result<{ status: ConnectionStatus }> }
    'connection.disconnect': { output: ConnectionStatus }
    /** Answers from the cache at once; refreshes in the background when old or `force`. */
    'items.list': { input: { force?: boolean } | undefined; output: ItemsState }
    /** `projectId` is the Plane project. */
    'item.get': { input: { key: string; projectId: string }; output: Result<{ item: ItemDetail }> }
    /** Every item's Start state that is not idle, reconciled with Orca's workspaces. */
    'starts.get': { output: Record<string, StartState> }
    /** Answers at once; the outcome arrives as `start.changed`. `agent` null starts no agent. */
    'item.start': {
      input: { key: string; orcaProjectId: string; hostId: string | null; agent: string | null; prompt: string }
      output: { accepted: true } | { accepted: false; reason: string }
    }
    /** Orca's Git projects, the only ones Start can use. */
    'orca.projects': { output: { projects: OrcaProject[] } }
    'workspace.open': { input: { workspaceId: string }; output: Result<{}> }
  }
  interface PluginPanelEvents {
    'connection.changed': ConnectionStatus
    'items.changed': ItemsState
    'start.changed': { key: string; state: StartState }
  }
}
