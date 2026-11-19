## Why

Start passes Orca only a workspace name; the branch is whatever Orca derives from it, possibly with a prefix (#16). Plane's Git development panel links a branch, commit or PR to an item when its name holds the item identifier (`feat/WEB-344-…`), and Plane's GitHub/GitLab automation moves the item's state when a PR that names the item merges. With an exact branch and the key in the PR title, the item's Git trail appears in Plane and its state follows the merge, while this plugin still never writes to Plane.

## What Changes

- A workspace started from an item gets the branch `<KEY-N>-<title slug>`, the same text as the workspace name.
- The Start confirmation shows the branch next to the workspace name.
- The default Start prompt asks the agent to put the item key in the title of any pull request it opens.

Out of scope: a configurable branch pattern, such as `feat/<KEY-N>-…` (#42); changing Plane state from Orca (#8).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: Start sets the workspace's branch, and the default prompt names the key for the PR title.

## Impact

- `src/starts.ts`: an in-memory map of pending Start creates for the hook (design B1).
- `src/worker.ts`, `orca-plugin.json`: a `workspace.create.before` hook (host `workspace.create` takes no branch).
- `src/start.ts`: `buildPrompt` gets the PR-title line.
- `src/panel.tsx`, `src/protocol.ts`: the confirmation shows the branch and sends the name it shows with `item.start` (design B2).
- `README.md`: Start names the branch after the item (task 2.2).
- Tests: `src/starts.test.ts`, `src/start.test.ts`, `src/worker.test.ts`, `src/panel.test.tsx`.
