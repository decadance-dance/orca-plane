## Context

The Start state machine (`src/starts.ts`, D3 in the archived `add-plane-work-items` design) stores, per connection, `item key → StartState`. A `created` state, or a `failed` one with a `workspaceId`, is the item↔workspace link, and `reconcile` drops a link whose workspace is gone. The stored id is what host `workspace.create` returned. Nothing listens to Orca events yet. Orca 1.4.262 offers (`orca skills get orca-plugin-authoring --reference events` and `--reference host-api`):

- `agent.status.changed` (`agent:read`): `{ workspaceId | null, workspaceListId?, paneKey, terminalId?, state, receivedAt, mainAgent?: { state, stateStartedAt, … } }`.
- `workspace.changed` (`workspace:read`): `{ context: { workspaceId?, branch, displayName, terminals[] } | null }`; each new subscriber first gets the current context.
- `workspace.list`, `terminal.list { workspaceId }` (worker).
- Plane v2 `GET /api/v2/workspaces/{slug}/work-items/{KEY-N}/` (get a work item by identifier, developers.plane.so) needs no project id.

Connection listeners run under the connection lock: `Connections.connect`/`disconnect` await them (`src/connection.ts`), and `Starts.mutate` waits for that same lock through `whileCurrent`. Awaiting a Start read inside a listener therefore deadlocks.

This change is the base for `agent-item-context` (the terminal → workspace map) and `keyboard-commands` (the waiting agents and the get-by-key read).

## Goals / Non-Goals

**Goals:** one place in the worker answers "which item is this workspace?" and "what is its agent doing?"; the panel and the status bar read it; any linked item's detail can be opened by its key alone.

**Non-Goals:** keeping agent states across worker restarts (Orca replays nothing, so a state after a restart is unknown until the next event); notifications (#18).

## Decisions

### L1. `Links` lives in the worker, in memory, built from Start states
A new class in `src/links.ts` holds `workspaceId → key`, `workspaceId → agent: { state, since } | null` and `terminalId → workspaceId`. It is rebuilt from `Starts.all()` on worker start and after each Start outcome. Agent states live in memory only.

Connection changes: the listener calls `links.clear()` synchronously and schedules `void links.rebuild(generation)` without awaiting it. The rebuild drops its result when `conns.generation` changed meanwhile. This avoids the listener → `Starts.all()` → `whileCurrent` deadlock.

Alternative: a second stored map. Rejected: the Start states are already the reconciled source of truth, and a copy could drift.

### L2. Matching events to links: ids only
An event's workspace is `workspaceListId ?? workspaceId`. A link matches when that id equals the stored id. Task 1.1 records in a test fixture which of the two ids `workspace.create` returns. If they differ, `Links` also keeps the other id, learned from `workspace.list` (a row's `id` is the list id) during the rebuild. Events with neither id are ignored. Branch and name are never used to match, because two repositories can share a branch name such as `main`.

For each event, `mainAgent.state` wins when present: it is the session's main agent, while `state` can come from a sub-pane. `blocked` and `waiting` both map to `needs-input`. `since` is `mainAgent.stateStartedAt` when present, otherwise the `receivedAt` of the first event of an unbroken needs-input run; a repeated waiting event keeps the earlier `since`. Every event with a `terminalId` records `terminalId → workspace`.

### L3. The worker subscribes; the panel asks and listens
The worker subscribes to `agent.status.changed` and `workspace.changed` (2 of the 5 events Orca 1.4.262 allows). It posts `links.changed` with `Record<itemKey, { workspaceId, agent: 'working' | 'needs-input' | 'done' | null }>`, and the panel gets the first value with `links.get`.

Alternative: the components panel subscribes itself. Rejected: the status bar needs the counts while the panel is closed, and two subscribers would compute the same map twice.

### L4. Following focus by `context.workspaceId`
On `workspace.changed`, the worker maps `context.workspaceId` to a key through L2, and posts `focus.changed { key | null }` only when the key differs from the last one posted, so "same workspace stays focused → nothing reopens". A context without `workspaceId` resolves to null. The initial event a new subscriber gets only sets the "last key", with no post, so opening Orca or reloading the worker never moves the panel. The panel opens the item on a non-null key unless a confirmation is open (the `confirming` atom is set).

### L5. Opening a linked item by key alone
`item.get` accepts `{ key, projectId? }`. With a `projectId` it works as today. Without one it calls the new `getItemByKey(conn, slug, key)` (identifier endpoint) with the same `expand`. The panel's `openItem` passes the list row's `projectId` when the item is listed and nothing otherwise. A linked item that left the list (done, reassigned), or a link saved before this change, still opens. `keyboard-commands` reuses `getItemByKey`.

### L6. One status bar path
`Items` keeps the last waiting count, and `showCount` always sends `text`, `tone` and `tooltip`: tone `warning` with `12 · 2 waiting` and the tooltip `2 agents on Plane items wait for you`, or tone `neutral` with the plain count and the manifest's default tooltip. Every caller (list refresh, `Links` on any change of the count, including a link drop on rebuild, disconnect) goes through it, so no stale warning survives a refresh or a removed link.

## Risks / Trade-offs

- [`workspace.create` and the events use different ids, and `workspace.list` is truncated] → the link keeps working for events that carry the stored id; the other id is learned on the next complete list (`// limit:`).
- [An agent event arrives for a workspace before its Start state is `created`] → the state is kept per workspace id even without a link, and shows once the link appears.
- [A worker restart loses agent states] → rows show nothing until the next event, which the spec allows ("no state known").
- [The user has not approved `agent:read`] → the plugin works as before; `Links` catches `capability_denied` when it subscribes.

## Migration Plan

No stored data changes. Orca asks the user to approve the new capability on update; until they do, these features stay off. If the event ids need host API 1.7, raise `engines.orca` to the first Orca that has it (task 1.2).
