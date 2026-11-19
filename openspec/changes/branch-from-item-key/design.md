## Context

`Starts.create` (`src/starts.ts`) calls host `workspace.create`. In Orca 1.4.262 its params are `{ projectId, hostId?, name?, baseBranch?, agent?, prompt?, setup?, open? }`: there is no `branch`, and the docs say that Orca's workspace-create hooks run for this create as for any other. The hook `workspace.create.before` gets `{ kind, projectId, name, branch?, base? }`, and `next` may change `name`, `branch` and `base`. It carries no caller or request id (`orca skills get orca-plugin-authoring --reference host-api`, Hooks). Plane links Git activity to an item by the identifier in the branch name (plane.so/changelog/git-development-panel-in-plane).

## Goals / Non-Goals

**Goals:** an exact branch for workspaces this plugin starts; the key in PR titles, so that Plane's own automation can link and move the item.

**Non-Goals:** branch patterns (#42); touching workspaces the plugin did not start.

## Decisions

### B1. A narrow `workspace.create.before` hook, gated by a live probe
`Starts` keeps an in-memory map `pending: (projectId, name) → branch`. An entry is added right before `workspace.create` is called and removed when the call settles. The hook changes `branch` to the pending name only when `kind === 'worktree'` and `(projectId, name)` is in that map. It decides from memory (no awaited call), so it finishes well within 2 s, and a throw passes the create unchanged.

The hook cannot tell a Start's create from a manual create with the same name in the same project during the seconds a Start is pending. The spec accepts this: such a create is a workspace named exactly like the item's, made while that item is being started, and giving it the item's branch is the intended result.

Task 1.1 is a gate. In a live Orca it proves (a) that the branch set by the hook is the final ref (Orca adds no prefix afterwards), and (b) that a concurrent manual create with a different name keeps Orca's branch. If (a) fails, the executor stops, reports on #16 with the observed branch, and asks the maintainer whether to drop the change or relax the requirement to "contains the key". The executor does not ship a partial exact-branch requirement.

Alternative: a hook that rewrites every create whose name looks like `KEY-N-…`. Rejected: it would touch workspaces the user made by hand.

### B2. The branch text is the workspace name
`workspaceName(key, title)` already gives ASCII, a lowercase slug and no leading or trailing dashes, which is a valid Git ref. Reusing it keeps "workspace = branch = Plane identifier" in one function.

### B3. The PR-title line belongs to the default prompt
`buildPrompt` adds `If you open a pull request for this item, put ${key} in its title.` before the fence, so the ticket text cannot override it. When `start-prompt-template` lands, a custom template replaces the default instructions, this line included; that change's spec says so.

## Risks / Trade-offs

- [The branch already exists in the repo, for example after a removed workspace] → Orca decides whether to reuse it or refuse; a refusal surfaces as a failed Start with Orca's message, as today. Task 1.1 records the observed behavior in the PR.
- [Orca normalizes `name` before the hook] → the map is keyed by the name exactly as passed; task 1.1 checks that the hook sees the same text. If it does not, key the map by `workspaceName` output and compare after the same normalization.
