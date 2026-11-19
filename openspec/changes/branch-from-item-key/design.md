## Context

`Starts.create` (`src/starts.ts`) calls host `workspace.create`. In Orca 1.4.262 its params are `{ projectId, hostId?, name?, baseBranch?, agent?, prompt?, setup?, open? }`: there is no `branch`, and the docs say that Orca's workspace-create hooks run for this create as for any other. The hook `workspace.create.before` gets `{ kind, projectId, name, branch?, base? }`, and `next` may change `name`, `branch` and `base`. It carries no caller or request id (`orca skills get orca-plugin-authoring --reference host-api`, Hooks). Plane links Git activity to an item by the identifier in the branch name (plane.so/changelog/git-development-panel-in-plane).

## Goals / Non-Goals

**Goals:** an exact branch for workspaces this plugin starts; the key in PR titles, so that Plane's own automation can link and move the item.

**Non-Goals:** branch patterns (#42); touching workspaces the plugin did not start.

## Decisions

### B1. A narrow `workspace.create.before` hook, gated by a live probe
`Starts` keeps an in-memory map `pending: (projectId, name) → branch`. An entry is added right before `workspace.create` is called and removed when the call settles. The hook changes `branch` to the pending name only when `kind === 'worktree'` and `(projectId, name)` is in that map. It decides from memory (no awaited call), so it finishes well within 2 s, and a throw passes the create unchanged.

The hook cannot tell a Start's create from a manual create with the same name in the same project during the seconds a Start is pending, so both get the same branch. The task 1.1 gate (comment on #16, Orca 1.4.262) showed that Orca fails neither create: it gives the second one `<name>-2` for its path and branch. So the Start's branch is exact unless a same-named worktree is made by hand in those seconds; then the Start gets `<name>-2`. The spec states this outcome; no other workspace ends up on a branch it did not ask for.

Task 1.1 was a gate. In a live Orca it proved (a) that the branch set by the hook is the final ref (Orca adds no prefix afterwards) and that the hook sees `name` exactly as the plugin passed it, (b) that a concurrent manual create with a different name keeps Orca's branch, and (c) what a concurrent manual create with the same name does: both succeed, the second with `-2`. Had (a) failed, the executor would have stopped and asked whether to drop the change or relax the requirement to "contains the key".

Alternative: a hook that rewrites every create whose name looks like `KEY-N-…`. Rejected: it would touch workspaces the user made by hand.

### B2. The branch text is the workspace name
`workspaceName(key, title)` already gives ASCII, a lowercase slug and no leading or trailing dashes, which is a valid Git ref. Reusing it keeps "workspace = branch = Plane identifier" in one function.

### B3. The PR-title line belongs to the default prompt
`buildPrompt` adds `If you open a pull request for this item, put ${key} in its title.` before the fence, so the ticket text cannot override it. When `start-prompt-template` lands, a custom template replaces the default instructions, this line included; that change's spec says so.

## Risks / Trade-offs

- [The branch already exists in the repo with no worktree, for example after a workspace removed without its branch] → Orca reuses it as it is, old commits included (gate on #16). No extra mechanism: the confirmation keeps showing the planned branch, which is the branch the workspace gets.
- [Orca normalizes `name` before the hook] → ruled out by the gate: the hook sees the name exactly as passed, so the map is keyed by it.
