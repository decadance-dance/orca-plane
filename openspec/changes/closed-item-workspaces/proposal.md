## Why

When an item is finished in Plane, it leaves the open list, but its Orca workspace stays, linked to an item the panel no longer shows. Workspaces of finished work pile up in Orca's sidebar, and the developer has to remember which ones are safe to remove (#40).

## What Changes

- Below the tabs, a collapsible section "No longer in your open items" lists linked workspaces whose item is not in the complete open list, with the item key and the workspace name.
- Each entry offers "Open workspace" and "Forget". Forget drops the link; the workspace stays.
- The section is shown only when the list is complete, because a partial or stale list cannot prove that an item left it.

Out of scope: removing the workspace from the plugin (the plugin API has no workspace removal; the developer removes it in Orca); asking Plane why the item left (done, cancelled or reassigned).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the list shows linked workspaces of items that are no longer open, and a link can be forgotten.

## Impact

- `src/starts.ts`: `forget(key)` drops one link under the lock.
- `src/protocol.ts`, `src/worker.ts`: `start.forget` request.
- `src/panel.tsx`: the section in `ListView`.
- Tests: `src/starts.test.ts`, `src/worker.test.ts`, `src/panel.test.tsx`.
