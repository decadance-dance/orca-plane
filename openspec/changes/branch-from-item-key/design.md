## Context

`Starts.create` (`src/starts.ts`) calls the host `workspace.create` with `projectId`, `hostId`, `name`, `agent` and `prompt`. The plugin docs snapshot used for planning does not list `workspace.create`'s params, while the `orca worktree create` CLI accepts `--branch`. Orca also offers the hook `workspace.create.before` (since 1.4.248), whose `next` may change `name`, `branch` and `base` (`references/host-api.md`, Hooks). Plane links Git activity to an item by the identifier in the branch name (plane.so/changelog/git-development-panel-in-plane).

## Goals / Non-Goals

**Goals:** an exact branch for workspaces this plugin starts; the key in PR titles so Plane's own automation can link and move the item.

**Non-Goals:** branch patterns; touching workspaces the plugin did not start.

## Decisions

### B1. Pass `branch` to `workspace.create` if Orca takes it; otherwise a narrow hook
Task 1.1 checks the generated types (`orca plugin types .`, `.orca/types`) for a `branch` param of `workspace.create`.

- If it exists: pass `branch: name`. No hook, no new manifest entry.
- If not: add a `workspace.create.before` hook. It changes `branch` only when the event's `name` equals the `name` of a `pending` Start state in the same `projectId`, and the hook decides from memory, with no awaited call (hooks have 2 s and a throw passes). `Starts` keeps an in-memory set of pending names for this purpose, filled before `workspace.create` is called.

Alternative: always a hook that rewrites every create whose name looks like `KEY-N-…`. Rejected: it would touch workspaces the user made by hand.

### B2. The branch text is the workspace name
`workspaceName(key, title)` already gives ASCII, a lowercase slug and no leading or trailing dashes, which is a valid Git ref. Reusing it keeps "workspace = branch = Plane identifier" in one function.

### B3. The PR-title line belongs to the default prompt
`buildPrompt` adds: `If you open a pull request for this item, put ${key} in its title.` It goes before the fence, so the ticket text cannot override it. When `start-prompt-template` lands, a custom template replaces the default instructions, this line included. That is the user's choice, and that change's spec says so.

## Risks / Trade-offs

- [The branch already exists in the repo, for example after a removed workspace] → Orca decides (it may reuse it or refuse); a refusal surfaces as a failed Start with Orca's message, as today. Task 1.1 records the observed behavior in the PR.
- [The hook path can miss if Orca normalizes `name` before the hook] → the hook also matches on the slugged name; if it still misses, the workspace gets Orca's branch, the same as today.

## Open Questions

- Does Orca add its branch prefix after `workspace.create.before`? Task 1.1 checks this in a live Orca and records the answer in the PR; either answer keeps the spec and the tasks.
