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
Both handlers read `Links` synchronously and never await the network or the host, so they finish well within 2 s, and a failure passes the prompt or launch unchanged (default `onError`). URLs come from `browseUrl(appBase, slug, key)` with the connection's full `appBase` (its path prefix included, as on a self-hosted Plane at `https://plane.example.org/tools/plane`) and slug, which `Links` keeps from the last `Connections.current()`.

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
`Starts.create` hands `{ generation, workspaceId, terminalId }` to `Links` synchronously as soon as the host call returns, before the storage write, so later launches and prompts see it. `Links` accepts the handoff only when `generation` equals `conns.generation`; a create that returns after an account switch never reaches the hook-visible map. There is no early link by name: the `workspace.created` event has no project, host or request id, and a manual create elsewhere could share the branch. If Orca launches the first agent before the call returns, that agent gets no env. The spec says so, and its prompt carries the key and URL anyway.

The launch hook names the workspace only as `<projectId>::<path>` (live probe, `test/fixtures/orca-ids.json`), never by the id a link is stored under, so `Links` keeps a map from that form to the stored id, filled two ways:
- events that carry both ids (`workspace.created`, `agent.status.changed`; `workspace.removed` drops the pair). The plan review dropped `workspace.created` as a source of links because a link by name could catch another create; here it only pairs two ids Orca gives for one workspace, and a pair links nothing until a Start's own create returned the same stored id, so it stays id to id. In the probe, `workspace.created` comes before the create returns, so the pair is known when the link lands.
- `workspace.list` rows at each rebuild: `${projectId}::${path}` maps to the row's id. It covers workspaces the events did not pair since the worker started. Orca does not document that form; the probe pins it (`// limit:` in the code), a row without `projectId` or `path` adds nothing, and only an exact match on the composed id is used, so it never guesses a link.

### A5. Parent in `ItemDetail`
`ItemDetail.parent: { key: string | null, title: string } | null`. `Items.detail` already requests `expand=state,assignees,labels`; it adds `parent`. Plane documents the expanded parent as `{ id, name, sequence_id }` with no project field, so the parent's project, and with it the key prefix, cannot be known from it. The block therefore shows the parent's title (`name`) alone, and `key` stays null. Task 1.1 records a real payload. If it carries a project identifier, the key is `${identifier}-${sequence_id}`; otherwise title-only stays. A missing or unreadable `parent` object gives `parent: null` (no extra request). The parent's fields go through `fence()`'s escaping and count toward its cap.

### A6. MCP pointer is documentation, not code
README gets a section "Let agents use Plane": use Plane's MCP server with its own token, never the plugin's, and note that ticket text read that way is untrusted too. Task 3.1 checks Plane's current MCP docs before writing the steps.

## Risks / Trade-offs

- [Another plugin's `agent.prompt.before` also rewrites the prompt] → plugins run in turn; the key check makes this handler idempotent.
- [`PLANE_ITEM_URL` reveals the workspace slug to agent tools] → it is the same URL the Start prompt already contains; no token.
- [`terminal.list` on many linked workspaces at each rebuild] → at most one call per linked workspace, only at worker start and Start outcomes; failures are ignored.
