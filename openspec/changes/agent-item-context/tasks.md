# Tasks

Requires `link-items-to-workspaces` merged into `develop`.

## 1. Richer ticket block

- [ ] 1.1 Find out what Plane v2 returns for `parent` with and without `expand=parent` (live server or Plane's API docs); record the answer in the PR. Add `parent: { key, title } | null` to `ItemDetail` in `src/plane/map.ts`, and fetch the parent in `Items.detail` only when the expand does not give it (design A5). Verify: `src/plane/map.test.ts` and `src/plane/api.test.ts` cover with a parent, without one, and a parent in another project.
- [ ] 1.2 `fence()` in `src/start.ts` takes priority, labels and the parent, escaped like the rest. Verify: `src/start.test.ts` covers "Item with a parent", "Parent title imitates the footer", and that the cap still holds.

## 2. Item pointer for later agents

- [ ] 2.1 In `Links`: keep the app origin and slug for URLs (A1); record `terminalId → workspaceId` from launch events (A3); early link from `workspace.created` against pending Start names (A4). Verify: `src/links.test.ts` covers each one.
- [ ] 2.2 Add the hooks `agent.prompt.before` and `agent.launch.before` and the event `workspace.created` to `orca-plugin.json`; handlers in `src/worker.ts` per A1 and A2. Verify: `src/worker.test.ts` covers the spec scenarios of "Later agent prompts name the linked item" and "Agents get the item in their environment", including that no env value equals the stored token; `orca plugin validate .` passes.

## 3. Docs

- [ ] 3.1 Check Plane's MCP server docs, then write the README section "Let agents use Plane" (A6). Comment on #20 with what Plane's MCP covers and what remains. Verify: the README steps match Plane's docs as of the PR date; the #20 comment is posted.
- [ ] 3.2 Live check in Orca: in a linked workspace, open a new agent tab and run `echo $PLANE_ITEM_KEY`; send an orchestration prompt and see the pointer line. Verify: the output is quoted in the PR; `bin/check` exits 0.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
