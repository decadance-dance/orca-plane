## Why

The panel opens only items from my open list, so an item that is assigned to someone else, or closed, cannot be read in Orca even when its key or URL is known (#11). Nothing in the plugin is reachable from the keyboard either: to find the agent that waits for you, or the workspace of the item you are reading, you go through the sidebar. Keyboard-first speed is the second most common wish about trackers after raw speed.

## What Changes

- The list gets a field that opens an item by `KEY-N` or by a pasted Plane URL of the connected workspace, whether or not it is in my list.
- An opened item that is in an open state group (backlog, unstarted, started) can be started like a listed one; the worker checks the state with Plane before it creates anything.
- Palette commands:
  - "Plane: go to an agent that waits for you": opens the linked workspace whose agent has waited longest; it has a default shortcut.
  - "Plane: open the workspace of the item shown in the panel".
  - "Plane: refresh my work items".
- The existing "Plane: toggle the right sidebar" command gets a default shortcut.

Out of scope: a palette command that takes text (Orca commands get no typed argument); opening the panel at a given item from a command (the plugin API cannot reveal a panel, only toggle the right sidebar).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: lookup by key or URL; Start for looked-up items; palette commands and shortcuts.

## Impact

- Depends on `link-items-to-workspaces` (the waiting agents with their wait start, and `getItemByKey`).
- `src/plane/url.ts`: parse a key or a Plane URL (with the app base's path prefix) into a reference.
- `src/plane/api.ts`: get an item by id for project-issue URLs.
- `src/starts.ts`: Start an item that is not listed after a fresh read from Plane.
- `src/worker.ts`, `src/protocol.ts`: `item.lookup` and `panel.shown` requests; command handlers.
- `orca-plugin.json`: three commands and two keybindings.
- `src/panel.tsx`: the lookup field; tells the worker which item it shows.
- Tests: `src/plane/url.test.ts`, `src/plane/api.test.ts`, `src/starts.test.ts`, `src/worker.test.ts`, `src/panel.test.tsx`.
