## Context

`Items.detail(key, projectId)` needs the Plane project id, which today comes from the list row. `browseUrl(appBase, slug, key)` in `src/plane/url.ts` builds `<app origin>/<slug>/browse/<KEY-N>/`. `Starts.start` refuses a key that is not in the cached list. A worker registers commands with `orca.commands.register(id, handler)`, and a string result is shown in Orca (`references/host-api.md`). `Links` (`link-items-to-workspaces`) knows the waiting agents and when each began to wait.

## Goals / Non-Goals

**Goals:** reach any item of the workspace by key or URL; reach the waiting agent in one keystroke.

**Non-Goals:** fuzzy search in Plane; commands with typed arguments.

## Decisions

### K1. Parse locally, then one request
`parseItemRef(text, conn)` in `src/plane/url.ts` accepts `KEY-N` (upper-cased) or a URL whose origin equals the connection's app origin and whose path is `/<slug>/browse/<KEY-N>/` with the connected slug. Anything else returns a reason, and no request is sent. The project-issue URL form (`/<slug>/projects/<uuid>/issues/<uuid>`) is also accepted when task 1.1 shows that v2 can fetch an item by its id; otherwise it gets a reason that says to paste the browse URL.

### K2. Fetch by key without a project id
Task 1.1 checks Plane v2 for a workspace-level "get work item by identifier" endpoint. If it exists, `getItemByKey(conn, slug, key)` uses it. Otherwise the project comes from `GET projects/` matched by `identifier` (cached for the session), then `getItem` as today.

### K3. Looked-up items join Start through a small cache
`Items` keeps the last 20 looked-up items (as `Item` rows) in memory. `Starts.start` looks in the list first, then in this cache, and refuses a cached item whose state group is not open. The duplicate protection is unchanged, because it is keyed by item key.

### K4. Commands
- `plane.nextWaiting`, "Plane: go to an agent that waits for you", keybinding `Mod+Alt+J` (task 2.2 checks that Orca does not already use it; if it does, pick another chord and say so in the PR). The handler takes the `needs-input` entries of `Links`, the one with the oldest state time first, and calls `workspace.open`; with none it returns the string "No agent on a Plane item waits for you."
- `plane.refresh`, "Plane: refresh my work items": `Items.refresh()`; it returns "Not connected to Plane." when disconnected.

## Risks / Trade-offs

- [The project list is large or paged] → fetch it once per connection and look up by identifier; on a miss, refetch once.
- [The shortcut clashes with the user's own] → Orca lets the user rebind it; the README names the default.
