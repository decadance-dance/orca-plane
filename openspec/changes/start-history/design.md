## Context

`Starts` (`src/starts.ts`) stores `keyOf(conn.id, 'starts')` through `mutate`, a lock that writes only while the connection generation is unchanged. A Start writes `pending` before the host call. `recover()` turns `pending` into `unknown` on worker start, and `reconcile` later resolves `unknown` against `workspace.list` (found → `created`, not found in a complete list → deleted). `Connections.disconnect` drops every storage key with the connection's prefix (`dropStorage` in `src/connection.ts`), so a new key under that prefix is erased on disconnect without new code.

## Goals / Non-Goals

**Goals:** a small, durable, local log in which every Start that passed the duplicate check appears, even when the worker stops at any point after that.

**Non-Goals:** an audit trail outside the machine; agent transcripts.

## Decisions

### H1. A separate key with attempt records
The key is `keyOf(conn.id, 'history')` and holds `Record<itemKey, Attempt[]>`, where `Attempt = { id, at, agent: string | null, project: string, projectId, workspace: string, outcome: 'pending' | 'created' | 'failed' | 'unknown' }`. The `id` is `${at}` (the Start's `startedAt`), unique per item. It is separate from `starts` because `reconcile` deletes Start states, while history must outlive them.

### H2. The attempt is written before the host call
In `Starts.start`, the same `mutate` that writes the `pending` state also appends the attempt with outcome `pending`: two `storage.set` calls, history first. A stop between them leaves an attempt without a state; H3 resolves it. Every later write updates the attempt by `id` and is idempotent: setting an outcome it already has is a no-op.

### H3. Outcomes come from three places, all by attempt id
- `create` sets `created` or `failed` (or `unknown`) for its attempt id.
- `recover()` turns `pending` attempts into `unknown`, as it does for states.
- `reconcile` resolves `unknown` attempts by their own `projectId` and `workspace` name against the same `workspace.list` answer: found → `created`, missing from a complete list → `failed`. It needs no Start state, so an attempt whose state was never written, or was already deleted, still gets resolved.

All writes go through `mutate`, which is guarded by the connection generation, so an answer for the old account never lands in the new one.

### H4. Caps and display
After each append: keep the last 10 attempts of the item; when more than 500 items are kept, drop those whose newest attempt is oldest. The panel calls `history.get { key }` in `openItem`, and again on `start.changed` for the opened key. It shows `pending` and `unknown` as "not confirmed".

## Risks / Trade-offs

- [The project name changes later in Orca] → the attempt keeps the name it had at Start, which is what the user saw then.
- [A history write fails] → the Start goes on (the error is caught); the attempt may be missing, and that is the only loss.
