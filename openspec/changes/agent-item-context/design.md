## Context

Builds on `link-items-to-workspaces` (`Links`: workspace id → key, and terminal id → workspace id). Orca 1.4.262 hooks (`orca skills get orca-plugin-authoring --reference host-api`, Hooks):

- `agent.prompt.before`: `{ agent, terminalId, prompt, inputKind }`; `next` may change `prompt`. A prompt the person types is never hooked.
- `agent.launch.before`: `{ agent, workspaceId | null, workspaceKind, terminalId?, command, env }`; `next` may change `command` and `env`. Restored sessions are not hooked.
- Each hook gets 2 s, and a throw or timeout passes unless the manifest says `onError: deny`.

Host `workspace.create` returns `{ workspaceId, terminalId? }` and starts the agent in the background "once setup has run". `terminal.list { workspaceId }` lists a workspace's terminals (worker, `workspace:read`). `fence()` in `src/start.ts` builds the ticket block. `ItemDetail` (`src/plane/map.ts`) has no parent today. Plane v2 documents `parent_id`, and with `expand=parent` a `parent` object (developers.plane.so: expanding relations, get work item).

## Goals / Non-Goals

**Goals:** every agent in a linked workspace can find its item in the cases the hooks can resolve; the first prompt carries more of the ticket's meaning; no new secret leaves the worker.

**Non-Goals:** an MCP server or skill in this plugin; comments in the block (#9); guessing which workspace a create belongs to by its name.

## Decisions

### A1. Hooks decide from memory only
Both handlers read `Links` synchronously and never await the network or the host, so they finish well within 2 s, and a failure passes the prompt or launch unchanged (default `onError`). URLs are built from the connection's app origin and slug, which `Links` keeps from the last `Connections.current()`.

### A2. The pointer line carries the key and URL, not the title
The line reads `Plane work item ${key}: ${url}`. #17 suggested also the title, but the title is ticket text, and outside the fence it would be an unfenced instruction channel. The key matches `^[A-Z0-9]+-\d+$` and the URL is built by the plugin, so both are safe. The line is added only when `prompt` does not already contain the key, which skips the Start prompt itself.

### A3. Seeding the terminal map
`agent.prompt.before` gives only a `terminalId`, so the map must be filled before the prompt. `Links` fills `terminalId → workspaceId` from:
- each rebuild: for every linked workspace, `terminal.list { workspaceId }` (awaited in the rebuild, never in a hook);
- the `terminalId` that `workspace.create` returns;
- `agent.launch.before` events with both ids;
- `agent.status.changed` events (L2);
- `workspace.changed` contexts that carry `workspaceId` (their `terminals[]`).

A terminal opened after the last seed, which gets a prompt before any of these report it, passes unchanged (`// limit:`, matching the "Terminal the plugin has not seen" scenario).

### A4. The link is known when `workspace.create` returns, and only then
`Starts.create` hands `{ workspaceId, terminalId }` to `Links` synchronously as soon as the host call returns, before the storage write, so later launches and prompts see it. There is no early link by name: the `workspace.created` event has no project, host or request id, and a manual create elsewhere could share the branch. If Orca launches the first agent before the call returns, that agent gets no env. The spec says so, and its prompt carries the key and URL anyway.

### A5. Parent in `ItemDetail`
`ItemDetail.parent: { key: string | null, title: string } | null`. `Items.detail` already requests `expand=state,assignees,labels`; it adds `parent`. From the expanded object: the title is `name`, and the key is `${project identifier}-${sequence_id}` when the payload gives the identifier (or the parent is in the item's own project, whose identifier is the item key's prefix). Otherwise the key is null and the block shows the title alone. A missing or unreadable `parent` object gives `parent: null` (no extra request). The parent's fields go through `fence()`'s escaping and count toward its cap.

### A6. MCP pointer is documentation, not code
README gets a section "Let agents use Plane": use Plane's MCP server with its own token, never the plugin's, and note that ticket text read that way is untrusted too. Task 3.1 checks Plane's current MCP docs before writing the steps.

## Risks / Trade-offs

- [Another plugin's `agent.prompt.before` also rewrites the prompt] → plugins run in turn; the key check makes this handler idempotent.
- [`PLANE_ITEM_URL` reveals the workspace slug to agent tools] → it is the same URL the Start prompt already contains; no token.
- [`terminal.list` on many linked workspaces at each rebuild] → at most one call per linked workspace, only at worker start and Start outcomes; failures are ignored.
