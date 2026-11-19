## Why

The panel opens only items from my open list, so an item that is assigned to someone else, or closed, cannot be read in Orca even when its key or URL is known (#11). Nothing in the plugin is reachable from the keyboard either: to find the agent that waits for you, you go through the sidebar. Keyboard-first speed is the second most common wish about trackers after raw speed.

## What Changes

- The list gets a field that opens an item by `KEY-N` or by a pasted Plane URL of the connected workspace, whether or not it is in my list.
- An opened item that is in an open state group (backlog, unstarted, started) can be started like a listed one.
- Palette command "Plane: go to an agent that waits for you": opens the linked workspace whose agent has waited longest; it has a default shortcut.
- Palette command "Plane: refresh my work items".

Out of scope: a palette command that takes text (Orca commands get no typed argument); opening the panel at a given item from a command (the plugin API cannot reveal a panel, only toggle the right sidebar).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: lookup by key or URL; Start for looked-up items; two palette commands and a shortcut.

## Impact

- Depends on `link-items-to-workspaces` (the waiting agents).
- `src/plane/url.ts`: parse a key or a Plane URL into a key.
- `src/plane/api.ts`, `src/items.ts`: get an item by key without knowing its project.
- `src/starts.ts`: accept a looked-up item.
- `src/worker.ts`, `src/protocol.ts`: `item.lookup` request; command handlers.
- `orca-plugin.json`: two commands and one keybinding.
- `src/panel.tsx`: the lookup field.
- Tests: `src/plane/url.test.ts`, `src/plane/api.test.ts`, `src/starts.test.ts`, `src/worker.test.ts`, `src/panel.test.tsx`.
