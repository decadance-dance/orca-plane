## Why

When an item is finished in Plane, it leaves the open list, but its Orca workspace stays, linked to an item the panel no longer shows. Workspaces of finished work pile up in Orca's sidebar, and the developer has to remember which ones are safe to remove (#40).

## What Changes

- Below the tabs, a collapsible section "No longer in your open items" lists linked workspaces whose item is not in the complete open list, with the item key and the workspace name.
- Each entry offers "Open workspace" and "Hide". Hide removes the entry from the section and keeps the link, so the item cannot be started a second time while its workspace exists.
- The section is shown only when the list is complete, because a partial or stale list cannot prove that an item left it.
- A Start whose agent failed after the workspace was created now keeps the workspace name, so the section can show it.

Out of scope: removing the workspace from the plugin (the plugin API has no workspace removal; the developer removes it in Orca); asking Plane why the item left (done, cancelled or reassigned); the agent badge in this section (it can follow once `link-items-to-workspaces` has landed, as part of that change's rows); releasing the link so the item can be started again while the old workspace exists, which would need a change to "Start does not create duplicate workspaces" (a pending maintainer decision, #41).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the list shows linked workspaces of items that are no longer open, and an entry can be hidden.

## Impact

- `src/protocol.ts`, `src/starts.ts`: `failed` states keep an optional `name`.
- `src/starts.ts`: a per-connection set of hidden keys; `hide(key)`; the set is cleaned when its link is dropped.
- `src/worker.ts`: `start.hide` request; `starts.get` also returns the hidden keys.
- `src/panel.tsx`: the section in `ListView`.
- Tests: `src/starts.test.ts`, `src/worker.test.ts`, `src/panel.test.tsx`.
