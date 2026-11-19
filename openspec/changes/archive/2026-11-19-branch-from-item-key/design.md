## Context

`Starts.create` (`src/starts.ts`) calls host `workspace.create`. In Orca 1.4.262 its params are `{ projectId, hostId?, name?, baseBranch?, agent?, prompt?, setup?, open? }`: there is no `branch`, and the docs say that Orca's workspace-create hooks run for this create as for any other. The hook `workspace.create.before` gets `{ kind, projectId, name, branch?, base? }`, and `next` may change `name`, `branch` and `base`. It carries no caller or request id (`orca skills get orca-plugin-authoring --reference host-api`, Hooks). Plane links Git activity to an item by the identifier in the branch name (plane.so/changelog/git-development-panel-in-plane).

## Goals / Non-Goals

**Goals:** an exact branch for workspaces this plugin starts; the key in PR titles, so that Plane's own automation can link and move the item.

**Non-Goals:** branch patterns (#42); touching workspaces the plugin did not start.

## Decisions

### B1. A narrow `workspace.create.before` hook, gated by a live probe
`Starts` keeps an in-memory count of its creates in flight per `(projectId, name)`; the branch is the name. The count goes up right before `workspace.create` is called and down when the call settles; the entry goes when it reaches 0. A count, not a flag: after an account switch, two Starts of the same key and title can be in flight in one project, and the first to settle must not clear the other's branch. The hook changes `branch` to the pending name only when `kind === 'worktree'` and `(projectId, name)` is in that map. It decides from memory (no awaited call), so it finishes well within 2 s, and a throw passes the create unchanged.

The hook cannot tell a Start's create from a manual create with the same name in the same project during the seconds a Start is pending, so both get the same branch. The task 1.1 gate (comment on #16, Orca 1.4.262) showed that Orca fails neither create: it gives the second one `<name>-2` for its path and branch. When the Start's create reaches Orca first, it gets the exact branch and the manual one gets `<name>-2`; when the manual one reaches Orca first, the Start gets `<name>-2`. The spec states this outcome; no other workspace ends up on a branch it did not ask for.

Task 1.1 was a gate. In a live Orca it proved (a) that the branch set by the hook is the final ref (Orca adds no prefix afterwards) and that the hook sees `name` exactly as the plugin passed it, (b) that a concurrent manual create with a different name keeps Orca's branch, and (c) what a concurrent manual create with the same name does: both succeed, the second with `-2`. Had (a) failed, the executor would have stopped and asked whether to drop the change or relax the requirement to "contains the key".

Alternative: a hook that rewrites every create whose name looks like `KEY-N-…`. Rejected: it would touch workspaces the user made by hand.

### B2. The branch text is the workspace name
`workspaceName(key, title)` already gives ASCII, a lowercase slug and no leading or trailing dashes, which is a valid Git ref. Reusing it keeps "workspace = branch = Plane identifier" in one function.

The confirmation names the workspace from the item detail it shows, which can be fresher than the worker's cached list. So the panel sends the name it shows with `item.start`, and the worker uses it only when `isWorkspaceName(key, name)` holds (a name `workspaceName` gives for that key); otherwise it refuses the Start. The shown branch is then the requested one by construction, even when the list changes while the confirmation is open. The mismatch between detail and list titles predates this change; it only became visible once the branch carries the name.

### B3. The PR-title line belongs to the default prompt
`buildPrompt` adds `If you open a pull request for this item, put ${key} in its title.` before the fence, so the ticket text cannot override it. When `start-prompt-template` lands, a custom template replaces the default instructions, this line included; that change's spec says so.

## Risks / Trade-offs

- [The branch already exists in the repo with no worktree, for example after a workspace removed without its branch] → Orca reuses it as it is, old commits included (gate on #16). No extra mechanism: the confirmation keeps showing the planned branch, which is the branch the workspace gets.
- [Orca normalizes `name` before the hook] → ruled out by the gate: the hook sees the name exactly as passed, so the map is keyed by it.
