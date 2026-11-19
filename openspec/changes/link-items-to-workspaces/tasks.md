# Tasks

## 1. Links model in the worker

- [ ] 1.1 Add `src/links.ts` (design L1, L2): builds `workspaceId → key` from Start states (`created`, and `failed` with `workspaceId`); matches events by `workspaceListId ?? workspaceId` only; keeps the agent state and `since` per workspace (`mainAgent` wins; blocked/waiting → `needs-input`; a repeated waiting event keeps `since`); records `terminalId → workspaceId`; exposes `byKey()`, `waiting()` (sorted by `since`), `keyOfWorkspace(id)`, `workspaceOfTerminal(id)`. Find out which id `workspace.create` returns compared with `workspace.list`, and pin it in a fixture. Verify: `src/links.test.ts` covers a link from created and from failed states, unlinked events and events without an id ignored, `mainAgent` preferred, `since` kept across repeated waiting events, and the waiting order.
- [ ] 1.2 Add `agent:read` to `capabilities`, and `agent.status.changed` and `workspace.changed` to `contributes.events` in `orca-plugin.json`; raise `engines.orca` if `workspaceListId` or `context.workspaceId` need a newer Orca than 1.4.259. Verify: `orca plugin validate .` passes.
- [ ] 1.3 Wire `Links` in `src/worker.ts`: rebuild on start and on every Start outcome. On connection change, clear synchronously and schedule the rebuild unawaited with a generation guard (L1). Subscribe to both events; add `links.get` and the `links.changed` and `focus.changed` events to `src/protocol.ts`. Verify: `src/worker.test.ts` covers an emitted `agent.status.changed` (waiting) for a linked workspace → `links.changed` with `needs-input`; `links.get` empty after a disconnect; a reconnect while a rebuild is in flight finishes (no deadlock) and shows only the new account's links.

## 2. Status bar

- [ ] 2.1 `Items.showCount` keeps the last waiting count and always sends text, tone and tooltip (L6); `Links` calls it on every change of the count. Verify: `src/worker.test.ts` checks the `statusBar.update` params with 0 and 2 waiting, after the agent works again, after a list refresh while one waits (the suffix stays), and after a waiting workspace's link is dropped (normal tone and tooltip again).

## 3. Open a linked item by key

- [ ] 3.1 Add `getItemByKey` to `src/plane/api.ts` (Plane v2 get by identifier, same `expand`); `item.get` takes an optional `projectId` (L5). Verify: `src/plane/api.test.ts` covers the request path and a 404; `src/worker.test.ts` covers `item.get` without `projectId`.

## 4. Focused workspace

- [ ] 4.1 In `Links`, map `workspace.changed` by `context.workspaceId` (L4): post `focus.changed` only when the key changes; the first event after subscribing only sets the last key. Verify: `src/links.test.ts` covers a linked id, an unlinked id (null), a context without an id (null), a repeated event for the same workspace (one post) and the initial event (no post).
- [ ] 4.2 In `src/panel.tsx`, on `focus.changed` with a key, open that item's detail (`openItem` with the list row's `projectId` when listed, else by key alone), unless a confirmation is open; ignore null. Verify: `src/panel.test.tsx` covers the four "Follow the focused workspace" scenarios.

## 5. Agent state in the panel

- [ ] 5.1 Load `links.get` in `loadConnected` and listen to `links.changed`; `ItemRow` and the detail show a Badge: Working (neutral), Needs input (warning), Done (success), nothing when null. Verify: `src/panel.test.tsx` covers the four "Show the agent state of a linked item" scenarios; `bin/check` exits 0.
- [ ] 5.2 Update the README feature list, then check by hand in Orca: start an item, let the agent ask a question, and see the badge and the status bar change; switch workspaces and see the panel follow. Verify: a screenshot from `orca plugin dev watch . --check` is attached to the PR.

## Workflow follow-up

- Archive the change after its PR merges into `develop` (`openspec archive link-items-to-workspaces`).
