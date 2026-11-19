## Context

Start states (`src/starts.ts`) keep a link (`created`, or `failed` with `workspaceId`) until its workspace is gone; nothing drops a link when the item leaves the list. A `failed` state today holds only `error` and `workspaceId` (`src/protocol.ts`), although `Starts.create` has the name at hand. The panel already has `starts` (all non-idle states, reconciled) and `items` (with `completeness`). The plugin API offers `workspace.open` and `workspace.list` (rows with `name`), but no workspace removal (`orca skills get orca-plugin-authoring --reference host-api`). "Start does not create duplicate workspaces" says that an item with a linked, existing workspace offers "Open workspace" instead of Start.

## Goals / Non-Goals

**Goals:** show leftovers from data the plugin already has; let the user clear the section without weakening duplicate protection.

**Non-Goals:** deleting workspaces; releasing a link while its workspace exists (it would allow a second workspace per item, which #41 leaves to the maintainer); the agent badge in this section.

## Decisions

### C1. Computed in the panel
Leftovers = keys of `starts` with a `workspaceId` that are not in `items.items` and not hidden, shown only when `items.completeness === 'complete'`. No new worker state is needed for the list itself.

Alternative: the worker computes it and posts it. Rejected: the inputs are already in the panel, and the rule is one filter.

### C2. Hide, not forget
`Starts.hide(key)` adds the key to a hidden set stored in `keyOf(conn.id, 'hidden')` under the same lock, and posts `start.changed`. The Start state is untouched, so duplicate protection holds. When `reconcile` deletes a link (its workspace is gone), it also removes the key from the hidden set, so a later link starts visible. `starts.get` returns `{ states, hidden }`. The panel's existing reader adapts.

Alternative: delete the Start state ("Forget"). Rejected in review: with the workspace still alive, the item could be started again into a second workspace, against the current requirement.

### C3. Workspace names
`Starts.create` stores `name` on a `failed` state that has a `workspaceId`; the field is optional, so existing records stay valid. An entry shows `state.name` when present. Links saved by earlier versions without a name show the key only (spec scenario "Link saved without a workspace name").

### C4. Placement
A `Collapsible` section after the tabs, titled "No longer in your open items (N)" and closed by default. Each row has the key, the name, an "Open workspace" button and a ghost "Hide" button.

## Risks / Trade-offs

- [The item was only reassigned, not finished] → the wording "No longer in your open items" stays true either way, and Hide leaves everything else alone.
- [A hidden entry the user wants back] → it returns when the item is listed again (as a normal row) or after the workspace is removed and the item started again; there is no "show hidden" control in this change.
