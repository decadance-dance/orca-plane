# Tasks

Requires `link-items-to-workspaces` merged into `develop`.

## 1. Lookup by key or URL

- [x] 1.1 `parseItemRef` in `src/plane/url.ts` per design K1. Verify: `src/plane/url.test.ts` covers a lower-case key, a Cloud browse URL, a self-hosted URL under a path prefix (a round trip from `browseUrl`), the same slug under another prefix, another slug, another origin, a project-issue URL and garbage.
- [x] 1.2 Add the project-scoped get by UUID to `src/plane/api.ts` (K2). Verify: `src/plane/api.test.ts` covers its request path and a 404.
- [x] 1.3 `item.lookup` in `src/protocol.ts` and `src/worker.ts`: parse, then `getItemByKey` or the UUID get. Verify: `src/worker.test.ts` covers found, not found and a refused URL (no fetch call).
- [x] 1.4 The lookup field above the tabs in `src/panel.tsx`; Enter opens the detail; messages go in a Callout. Verify: `src/panel.test.tsx` covers the five "Open an item by key or URL" scenarios.

## 2. Start for looked-up items

- [ ] 2.1 `Starts.start` rereads an unlisted key under the current generation and refuses closed items (K3); the detail shows Start only for an open state group. Verify: `src/starts.test.ts` covers start of an open unlisted item, closed between lookup and Start (refused, no create), an account switch during the read (dropped), and a listed item (no read); `src/panel.test.tsx` covers "Closed item".

## 3. Commands

- [ ] 3.1 Add `plane.nextWaiting`, `plane.openShown`, `plane.refresh` and the two keybindings to `orca-plugin.json`; register the handlers in `src/worker.ts`; the panel sends `panel.shown` (K4). Verify: `src/worker.test.ts` covers two waiting agents (the earliest wait opens, also after the other reports again), none waiting (message, no `workspace.open`), shown item with and without a workspace, no shown item, and refresh; `orca plugin validate .` passes.
- [ ] 3.2 Live check in Orca: both shortcuts work and neither chord clashes with Orca's own; README lists the commands and shortcuts. Verify: noted in the PR; `bin/check` exits 0.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
