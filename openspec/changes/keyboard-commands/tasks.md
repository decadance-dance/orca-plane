# Tasks

Requires `link-items-to-workspaces` merged into `develop`.

## 1. Lookup by key or URL

- [ ] 1.1 Find out in Plane v2 (API docs or a live server) whether an item can be fetched by its identifier at the workspace level, and by id; record the answer in the PR and implement design K2. Verify: `src/plane/api.test.ts` covers the chosen path, including not found (404).
- [ ] 1.2 `parseItemRef` in `src/plane/url.ts` per K1. Verify: `src/plane/url.test.ts` covers a key in lower case, a browse URL, another slug, another origin, garbage, and the project-issue form.
- [ ] 1.3 `item.lookup` in `src/protocol.ts` and `src/worker.ts`, backed by `Items.lookup` with the cache of K3. Verify: `src/worker.test.ts` covers found, not found and a refused URL (no fetch call).
- [ ] 1.4 The lookup field above the tabs in `src/panel.tsx`; Enter opens the detail; messages go in a Callout. Verify: `src/panel.test.tsx` covers the four "Open an item by key or URL" scenarios.

## 2. Start for looked-up items

- [ ] 2.1 `Starts.start` accepts open items from the lookup cache (K3); the detail shows Start only for an open state group. Verify: `src/starts.test.ts` and `src/panel.test.tsx` cover both "Start a looked-up item" scenarios.

## 3. Commands

- [ ] 3.1 Add the two commands and the keybinding to `orca-plugin.json`; register the handlers in `src/worker.ts` (K4). Verify: `src/worker.test.ts` covers two waiting agents (the longest-waiting opens), none waiting (message, no `workspace.open`), and refresh; `orca plugin validate .` passes.
- [ ] 3.2 Live check in Orca: the shortcut opens the waiting agent's workspace, and the chord does not clash with Orca's. README lists the commands and the shortcut. Verify: noted in the PR; `bin/check` exits 0.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
