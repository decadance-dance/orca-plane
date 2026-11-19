## Context

Builds on `link-items-to-workspaces` (`Links`: `workspaceId → key`, `terminalId → workspaceId`). Orca hooks (`references/host-api.md`, Hooks):

- `agent.prompt.before`: `{ agent, terminalId, prompt, inputKind }`; `next` may change `prompt`. A prompt the person types is never hooked.
- `agent.launch.before`: `{ agent, workspaceId, workspaceKind, terminalId?, command, env }`; `next` may change `command` and `env`. Restored sessions are not hooked.
- Each hook gets 2 s; a throw or timeout passes unless the manifest says `onError: deny`.

`fence()` in `src/start.ts` builds the ticket block; `ItemDetail` (`src/plane/map.ts`) has no parent today. Plane v2 work items carry `parent` (an id).

## Goals / Non-Goals

**Goals:** every agent in a linked workspace can find its item; the first prompt carries more of the ticket's meaning; no new secret leaves the worker.

**Non-Goals:** an MCP server or skill in this plugin; comments in the block (#9).

## Decisions

### A1. Hooks decide from memory only
Both handlers read `Links` synchronously and never await the network or the host, so they finish well within 2 s, and a failure passes the prompt or launch unchanged (default `onError`). The key → URL map uses the connection's app origin and slug, which `Links` keeps from the last `Connections.current()`.

### A2. The pointer line carries the key and URL, not the title
The line reads `Plane work item ${key}: ${url}`. #17 suggested also the title, but the title is ticket text, and outside the fence it would be an unfenced instruction channel. The key matches `^[A-Z0-9]+-\d+$` and the URL is built by the plugin, so both are safe. The line is added only when `prompt` does not already contain the key, which skips the Start prompt itself.

### A3. Terminal → workspace from two sources
`agent.launch.before` records `terminalId → workspaceId` when both are present, and `agent.status.changed` already records it (L2). A prompt for a terminal not seen yet passes unchanged (`// limit:`).

### A4. Early link for the Start's own agent
The Start state becomes `created` only after `workspace.create` returns, which can come after Orca launches the first agent. The worker subscribes to `workspace.created` (the 3rd of 4 allowed events) and, when its `branch` or the last segment of its `path` equals the `name` of a `pending` Start, links that workspace id to the key at once. When the race is lost anyway, the first agent still has the key and URL in its Start prompt.

### A5. Parent in `ItemDetail`
`ItemDetail.parent: { key, title } | null`. Task 1.1 checks whether v2 `expand=parent` returns the parent's `sequence_id` and `name` (the key prefix comes from the item's own project identifier when the parent is in the same project). If not, `Items.detail` makes one extra GET for the parent, only when `parent` is set; the 60 requests per minute budget holds, because a detail is opened by hand.

### A6. MCP pointer is documentation, not code
README gets a section "Let agents use Plane": use Plane's MCP server with its own token, never the plugin's, and note that ticket text read that way is untrusted too. Task 3.1 checks Plane's current MCP docs before writing the steps.

## Risks / Trade-offs

- [Another plugin's `agent.prompt.before` also rewrites the prompt] → plugins run in turn; the key check makes this handler idempotent.
- [`PLANE_ITEM_URL` reveals the workspace slug to agent tools] → it is the same URL the Start prompt already contains; no token.
- [A parent in another project] → its key prefix is unknown without a project lookup; show the title with the key when the payload gives `project__identifier`, else the title only (`// limit:`).
