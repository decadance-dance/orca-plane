## Why

After Start, the panel and the item's Orca workspace barely know about each other. Switching to the workspace does not show its item. The list does not say which items have an agent working, waiting or done. The status bar does not say that an agent waits for the developer, so the developer checks every workspace by hand (#36). Context switching is the top complaint about issue trackers, and the link between an item and its agent is something this plugin can offer that Plane cannot.

## What Changes

- The plugin keeps using the item↔workspace link it already stores for Start, and tracks the latest agent state of each linked workspace from Orca's `agent.status.changed` events.
- List rows and the item detail of a linked item show its agent state: working, needs input or done.
- When the focused Orca workspace is linked to an item, the panel shows that item's detail.
- The status bar adds the number of linked agents that need input, in a warning tone.
- The plugin asks Orca for one new capability: `agent:read` (agent status events).

Out of scope: desktop notifications when an agent changes state (#18, which builds on this link); several workspaces per item (a pending decision, see #41).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: adds the agent state of linked items and following the focused workspace; the status bar also shows agents that need input.

## Impact

- `orca-plugin.json`: capability `agent:read`; `contributes.events` for `agent.status.changed` and `workspace.changed`.
- `src/links.ts` (new): the in-memory agent state per linked workspace and the lookup from the focused workspace to its item.
- `src/starts.ts`: exposes the current links (item key → workspace id); how they are stored does not change.
- `src/items.ts`: `showCount` also takes the number of agents that need input; `detail` can fetch by key alone.
- `src/plane/api.ts`: `getItemByKey` (Plane v2 get a work item by identifier).
- `src/worker.ts`, `src/protocol.ts`: a `links.get` request, `item.get` with an optional `projectId`, and the panel events `links.changed` and `focus.changed`.
- `src/panel.tsx`: agent badges on rows and in the detail; following the focused workspace.
- Tests: `src/links.test.ts` (new), `src/worker.test.ts`, `src/panel.test.tsx`.
