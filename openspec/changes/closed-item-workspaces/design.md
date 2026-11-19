## Context

Start states (`src/starts.ts`) keep a link (`created`, or `failed` with `workspaceId`) until its workspace is gone; nothing drops a link when the item leaves the list. The panel already has `starts` (all non-idle states, reconciled) and `items` (with `completeness`). The plugin API offers `workspace.open` but no workspace removal (`references/host-api.md`).

## Goals / Non-Goals

**Goals:** show leftovers from data the panel already has; one action that cleans the plugin's own state.

**Non-Goals:** deleting workspaces; finding out why an item left.

## Decisions

### C1. Computed in the panel
Leftovers = keys of `starts` with a `workspaceId` that are not in `items.items`, shown only when `items.completeness === 'complete'`. The workspace name comes from the state (`name` on `created`; a `failed` state with `workspaceId` has no name, so it shows the key only). No new worker state is needed.

Alternative: the worker computes it and posts it. Rejected: both inputs are already in the panel, and the rule is one filter.

### C2. `Starts.forget(key)` under the lock
It deletes `states[key]` only when the state is `created` or `failed` (never `pending` or `unknown`, which belong to a running Start), posts `start.changed` with `idle`, and returns `{ ok }`. Exposed as `start.forget { key }`.

### C3. Placement
A `Collapsible` section after the tabs, titled "No longer in your open items (N)", closed by default. Each row has the key, the workspace name, an "Open workspace" button and a ghost "Forget" button. When `link-items-to-workspaces` has landed, the row also shows the agent badge.

## Risks / Trade-offs

- [The item was only reassigned, not finished] → the wording "No longer in your open items" stays true either way, and Forget leaves the workspace alone.
- [Forget pressed during a refresh that brings the item back] → the item shows Start; its old workspace still exists in Orca and can be opened from there.
