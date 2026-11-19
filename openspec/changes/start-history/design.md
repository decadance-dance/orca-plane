## Context

`Starts` (`src/starts.ts`) stores `keyOf(conn.id, 'starts')`. `Connections.disconnect` drops every storage key with the connection's prefix (`dropStorage` in `src/connection.ts`), so a new key under the same prefix is erased on disconnect without new code. The Start outcome is written in `Starts.create`, and an `unknown` outcome is resolved later in `reconcile`.

## Goals / Non-Goals

**Goals:** a small, durable, local log, written in the same place as the outcome.

**Non-Goals:** an audit trail outside the machine; agent transcripts.

## Decisions

### H1. A separate key `keyOf(conn.id, 'history')`
The shape is `Record<itemKey, Entry[]>`, where `Entry = { at, agent: string | null, project: string, workspace: string, outcome: 'created' | 'failed' | 'unknown' }`. It is separate from `starts` because `reconcile` deletes Start states, while history must outlive them. Writes go through the same `mutate` lock pattern (a second lock-guarded helper, or `mutate` generalized over the key), so concurrent outcomes do not lose entries.

### H2. Written at the outcome; unknown is patched
`create` appends one entry with the outcome. When `reconcile` turns `unknown` into `created`, it updates the newest `unknown` entry of that key to `created`. When it drops an `unknown` (no workspace found), the entry becomes `failed`. The agent and project names come from the `StartInput` and the project list; an agent of `null` shows as "Terminal only".

### H3. Caps
After each append: keep the last 10 entries of the item; when more than 500 items are kept, drop those whose newest entry is oldest.

### H4. The panel asks once per opened item
`history.get { key }` returns that item's entries; the panel calls it in `openItem` and again on `start.changed` for the opened key.

## Risks / Trade-offs

- [The project name changes later in Orca] → the entry keeps the name it had at Start, which is what the user saw then.
- [Storage write fails] → the Start outcome is written first; a failed history write is caught and does not change the Start.
