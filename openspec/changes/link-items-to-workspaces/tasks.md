# Tasks

## 1. Links model in the worker

- [ ] 1.1 Add `src/links.ts` (design L1, L2): builds `workspaceId → key` from Start states (`created`, and `failed` with `workspaceId`); keeps the agent state per workspace (`mainAgent.state` wins; blocked/waiting → `needs-input`); records `terminalId → workspaceId`; exposes `byKey()`, `waitingCount()`, `keyOfWorkspace(id)`, `workspaceOfTerminal(id)`. Verify: `src/links.test.ts` covers a link from created and from failed states, unlinked and `workspaceId: null` events ignored, `mainAgent` preferred, the waiting count.
- [ ] 1.2 Add `agent:read` to `capabilities`, and `agent.status.changed` and `workspace.changed` to `contributes.events` in `orca-plugin.json`. Verify: `orca plugin validate .` passes.
- [ ] 1.3 Wire `Links` in `src/worker.ts`: rebuild on start, on every Start outcome and on connection change (clear on disconnect); subscribe to both events; add `links.get` and the `links.changed` and `focus.changed` events to `src/protocol.ts`. Verify: in `src/worker.test.ts`, an emitted `agent.status.changed` (state waiting) for a linked workspace yields `links.changed` with `needs-input`; after a disconnect `links.get` is empty.

## 2. Status bar

- [ ] 2.1 `Items.showCount` takes the waiting count (design L4): `12 · 2 waiting`, tone `warning`, tooltip; unchanged at 0; `?` keeps the waiting suffix when the count is above 0. `Links` calls it on each change of the count. Verify: `src/worker.test.ts` checks the `statusBar.update` params with 0 and 2 waiting, and after the agent works again.

## 3. Focused workspace

- [ ] 3.1 In `Links`, resolve `workspace.changed` to an item key by branch, then by name, against a `workspace.list` cached for 30 s; post `focus.changed` only when the key changes (design L3). Verify: `src/links.test.ts` covers a branch match, the name fallback, an unlinked workspace (null) and a repeated event for the same workspace (one post).
- [ ] 3.2 In `src/panel.tsx`, on `focus.changed` with a key, open that item's detail (`openItem`) unless a confirmation is open; ignore null. Verify: `src/panel.test.tsx` covers the three "Follow the focused workspace" scenarios.

## 4. Agent state in the panel

- [ ] 4.1 Load `links.get` in `loadConnected` and listen to `links.changed`; `ItemRow` and the detail show a Badge: Working (neutral), Needs input (warning), Done (success), nothing when null. Verify: `src/panel.test.tsx` covers the four "Show the agent state of a linked item" scenarios; `bin/check` exits 0.
- [ ] 4.2 Update the README feature list, then check by hand in Orca: start an item, let the agent ask a question, and see the badge and the status bar change. Verify: a screenshot from `orca plugin dev watch . --check` is attached to the PR.

## Workflow follow-up

- Archive the change after its PR merges into `develop` (`openspec archive link-items-to-workspaces`).
