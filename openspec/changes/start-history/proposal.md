## Why

The item detail does not say whether an agent has already worked on the item. Once a workspace is removed, its link is dropped, and a second Start looks like the first. The developer cannot tell when an item was started before, with which agent and in which project (#39). Developers distrust agent output (Stack Overflow 2025: 46%), and a visible record of what ran on an item helps.

## What Changes

- The plugin keeps a short per-item log of Starts: when, which agent, which Orca project, the workspace name and the outcome.
- The item detail shows that log, newest first, under "Earlier starts".
- The log survives removed workspaces and worker restarts, and is erased on disconnect along with the connection's other data.

Out of scope: what the agent did in the workspace (its transcript or PR); history shared across machines (plugin storage is local).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the item detail shows earlier Starts.

## Impact

- `src/starts.ts`: writes an attempt before the host call, and sets its outcome from the create, worker recovery and reconciliation.
- `src/protocol.ts`, `src/worker.ts`: `history.get` request.
- `src/panel.tsx`: the "Earlier starts" section in the detail.
- Tests: `src/starts.test.ts`, `src/worker.test.ts`, `src/panel.test.tsx`.
