## Context

`link-items-to-workspaces` adds `getItemByKey` (Plane v2 get a work item by identifier) and `item.get` without a project id, and `Links.waiting()` sorted by when each agent began to wait (`mainAgent.stateStartedAt`, kept across repeated waiting events). `browseUrl(appBase, slug, key)` in `src/plane/url.ts` builds `${appBase}/${slug}/browse/${key}/`, and `appBase` may carry a path prefix on self-hosted Plane. Plane v2 also documents a project-scoped get by UUID (developers.plane.so: get work item, get work item by identifier). `Starts.start` refuses a key that is not in the cached list. A worker registers commands with `orca.commands.register(id, handler)`, and a string result is shown in Orca. A keybinding may target any contributed command, including a declarative one such as `plane.toggleSidebar` (`orca skills get orca-plugin-authoring --reference manifest`, KeybindingContribution).

## Goals / Non-Goals

**Goals:** reach any item of the workspace by key or URL; reach the waiting agent, or the shown item's workspace, in one keystroke.

**Non-Goals:** fuzzy search in Plane; commands with typed arguments.

## Decisions

### K1. Parse locally against the connected app base
`parseItemRef(text, conn)` in `src/plane/url.ts` returns `{ key }`, `{ projectId, id }` or `{ reason }`:
- `KEY-N` in any case → `{ key }`, upper-cased;
- a URL that starts with `${appBase}/${slug}/browse/` (path prefix included, compared after normalizing trailing slashes) and continues with a key → `{ key }`;
- a URL that starts with `${appBase}/${slug}/projects/<uuid>/issues/<uuid>` → `{ projectId, id }`;
- anything else → a reason, and no request is sent.

Tests round-trip `browseUrl` output and reject the same slug under another prefix or origin.

### K2. Reads use the documented endpoints
A key goes through `getItemByKey`; a project-issue URL goes through the project-scoped get by UUID. Both use the detail's existing `expand`. A 404 means "no item has that key". The plugin supports only servers with API v2 (D1 of the archived design), so a missing route is not handled separately.

### K3. No lookup cache; Start rereads
`Starts.start` takes the item from the list when it is listed, exactly as today: the list is the truth until the next refresh. For a key that is not listed, it calls `getItemByKey` under the current connection generation, refuses when the item is not in an open state group, and drops the result when the generation changed during the call. With no lookup cache, nothing can leak across an account switch.

### K4. Commands and shortcuts
- `plane.nextWaiting`, "Plane: go to an agent that waits for you", keybinding `Mod+Alt+J`: opens the first entry of `Links.waiting()` with `workspace.open`; with none, it returns "No agent on a Plane item waits for you."
- `plane.openShown`, "Plane: open the workspace of the item shown in the panel": the panel sends `panel.shown { key | null }` whenever its detail opens or closes. The worker keeps the last value in memory and opens its linked workspace; otherwise it returns "The panel shows no item." or "DIOGEN-449 has no workspace."
- `plane.refresh`, "Plane: refresh my work items": `Items.refresh()`; when disconnected it returns "Not connected to Plane."
- Keybinding `Mod+Alt+P` for the existing `plane.toggleSidebar`.

Task 3.2 checks in a live Orca that neither chord is taken; if one is, pick another and say so in the PR.

## Risks / Trade-offs

- [Several panels show different items] → the last one to send `panel.shown` wins; the command acts on what was opened most recently.
- [The shortcut clashes with the user's own] → Orca lets the user rebind it; the README names the defaults.
