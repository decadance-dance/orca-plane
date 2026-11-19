## Why

Only the first agent of a Start learns which item it works on. An agent started later in the same workspace (a new tab, an orchestration dispatch, a resumed session) gets no hint (#17). Scripts and skills in the workspace cannot find out the item either. The ticket block also leaves out priority, labels and the parent item, which tell the agent how much the task matters and what larger goal it serves. Agents that should read or update Plane themselves (#20) can already use Plane's own MCP server; they only need to be pointed to it.

## What Changes

- Prompts that Orca sends to an agent in a workspace linked to an item get one leading line with the item key and URL, unless they already name the key.
- Agents launched in a linked workspace get `PLANE_ITEM_KEY` and `PLANE_ITEM_URL` in their environment. The token is never passed.
- The fenced ticket block in the Start prompt also carries the item's priority, its labels and its parent item's key and title.
- The README explains how to give agents their own Plane access through Plane's MCP server, with a separate token. This answers #20 without the plugin running an MCP server.

Out of scope: the plugin's own MCP server or agent skill (#20 stays open for anything Plane's MCP server cannot do); comments in the ticket block (#9).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: later prompts and agent environments name the linked item; the ticket block gains priority, labels and the parent item.

## Impact

- Depends on `link-items-to-workspaces` (the `Links` class and its terminal → workspace map).
- `orca-plugin.json`: hooks `agent.prompt.before` and `agent.launch.before`.
- `src/links.ts`: a terminal map seeded from `terminal.list` and Orca's events, the link from `workspace.create`'s answer, and the connection's app origin and slug for URLs.
- `src/starts.ts`: hands the new workspace and terminal ids to `Links` as soon as the create returns.
- `src/worker.ts`: the two hook handlers.
- `src/start.ts`: the ticket block fields; a one-line item pointer helper.
- `src/plane/map.ts`, `src/plane/api.ts`, `src/items.ts`: the parent item in `ItemDetail`.
- `README.md`: a section on Plane's MCP server.
- Tests: `src/start.test.ts`, `src/links.test.ts`, `src/worker.test.ts`, `src/plane/map.test.ts`, `src/plane/api.test.ts`.
