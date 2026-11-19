## Context

The Start state machine (`src/starts.ts`, D3 in the archived `add-plane-work-items` design) stores, per connection, `item key → StartState`. A `created` state, or a `failed` one with a `workspaceId`, is the item↔workspace link; `reconcile` drops a link whose workspace is gone. Nothing listens to Orca events yet. Orca offers (plugin docs, `references/events.md` and `host-api.md`):

- `agent.status.changed` (`agent:read`): `{ workspaceId | null, paneKey, terminalId?, state: working|blocked|waiting|done, mainAgent? }`.
- `workspace.changed` (`workspace:read`): `{ context: { branch, displayName, terminals[] } | null }`. It carries no workspace id.
- `workspace.list` (worker): rows with `id`, `name`, `branch`, `path`, `hostId`.

This change is the base for `agent-item-context` (the terminal → workspace map), `keyboard-commands` (the next waiting agent) and `closed-item-workspaces`.

## Goals / Non-Goals

**Goals:** one place in the worker answers "which item is this workspace?" and "what is its agent doing?"; the panel and the status bar read it.

**Non-Goals:** keeping agent states across worker restarts (Orca replays nothing, so a state after a restart is unknown until the next event); notifications (#18).

## Decisions

### L1. `Links` lives in the worker, in memory, built from Start states
A new class in `src/links.ts` holds `workspaceId → { key, agent: { state, at } | null }` and `terminalId → workspaceId`. It rebuilds the key map from `Starts.all()` on worker start, after each Start outcome, and when the connection changes (a disconnect clears everything). Agent states live in memory only.

Alternative: a second stored map. Rejected: the Start states are already the reconciled source of truth, and a copy could drift.

### L2. The worker subscribes; the panel asks and listens
The worker subscribes to `agent.status.changed` and `workspace.changed` (`contributes.events`, 2 of the 4 allowed). It posts `links.changed` with `Record<itemKey, { workspaceId, agent: 'working' | 'needs-input' | 'done' | null }>`, and the panel gets the first value with `links.get`.

Alternative: the components panel subscribes itself. Rejected: the status bar needs the counts while the panel is closed, and two subscribers would compute the same map twice.

For each event, `mainAgent.state` wins when present: it is the session's main agent, while `state` can come from a sub-pane. `blocked` and `waiting` both map to `needs-input`. Events with `workspaceId: null` are ignored for states. Every event with a `terminalId` also records `terminalId → workspaceId`, which `agent-item-context` uses.

### L3. From the focused workspace to its item: by branch, then by name
`workspace.changed` has no workspace id. The worker matches `context.branch` against `workspace.list` rows (falling back to `displayName` = the row's `name`) and takes the row's id. The list result is cached for 30 s, because focus events come in bursts: renaming a terminal fires the event again. The worker posts `focus.changed { key | null }` only when the resolved key differs from the last one posted, which gives "same workspace stays focused → nothing reopens". On a non-null key the panel opens that item's detail, unless a confirmation is open (the `confirming` atom is set).

Alternative: parse `KEY-N` out of the branch. Rejected: any branch can contain a key; only the stored link proves which item the workspace belongs to.

### L4. Status bar text
`Items.showCount(cache, waiting)` renders `12 · 2 waiting` with `tone: 'warning'` and the tooltip `2 agents on Plane items wait for you`; with 0 waiting the output is unchanged. `Links` calls it whenever the waiting count changes, using the cached list, so no Plane request is made.

## Risks / Trade-offs

- [Two workspaces share a branch name on different hosts] → match by branch and `hostId` when the context gives a host; otherwise take the first match, marked with a `// limit:` comment.
- [An agent event arrives for a workspace before its Start state is `created`] → the state is kept per workspace id even without a link, and shows once the link appears.
- [A worker restart loses agent states] → rows show nothing until the next event, which the spec allows ("no state known").
- [The user has not approved `agent:read`] → the plugin works as before; `Links` catches `capability_denied` when it subscribes.

## Migration Plan

No stored data changes. Orca asks the user to approve the new capability on update; until they do, these features stay off.
