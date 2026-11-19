# Tasks

Requires `link-items-to-workspaces` merged into `develop`.

## 1. Richer ticket block

- [ ] 1.1 Request `expand=…,parent` in `Items.detail`; map the parent per design A5 in `src/plane/map.ts`, with no extra request. Record a real v2 payload's parent fields in the PR (live server or Plane's API docs). Verify: `src/plane/map.test.ts` covers a parent in the same project (key and title), in another project with an identifier, without an identifier (title only), and missing (null).
- [ ] 1.2 `fence()` in `src/start.ts` takes priority, labels and the parent, escaped like the rest and inside the cap. Verify: `src/start.test.ts` covers "Item with a parent", "Parent title imitates the footer", "Parent cannot be read", and the cap still holding.

## 2. Item pointer for later agents

- [ ] 2.1 In `Links`: keep the app origin and slug for URLs (A1); seed `terminalId → workspaceId` from `terminal.list` at rebuild, from launch events and from focused contexts (A3); accept `{ workspaceId, terminalId }` from `Starts.create` right after the host call returns (A4). Verify: `src/links.test.ts` covers each source, a prompt to an unseen terminal (no match), and that no name-based link exists.
- [ ] 2.2 Add the hooks `agent.prompt.before` and `agent.launch.before` to `orca-plugin.json`; handlers in `src/worker.ts` per A1 and A2. Verify: `src/worker.test.ts` covers every scenario of "Later agent prompts name the linked item" and "Agents get the item in their environment", including the first agent launched before the create returns, and that no env value equals the stored token; `orca plugin validate .` passes.

## 3. Docs

- [ ] 3.1 Check Plane's MCP server docs, then write the README section "Let agents use Plane" (A6). Comment on #20 with what Plane's MCP covers and what remains. Verify: the README steps match Plane's docs as of the PR date; the #20 comment is posted.
- [ ] 3.2 Live check in Orca: in a linked workspace, open a new agent tab and run `echo $PLANE_ITEM_KEY`; send an orchestration prompt and see the pointer line. Verify: the output is quoted in the PR; `bin/check` exits 0.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
