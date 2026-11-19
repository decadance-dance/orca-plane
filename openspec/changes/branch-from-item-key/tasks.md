# Tasks

## 1. Exact branch

- [ ] 1.1 Gate (design B1): with a throwaway plugin build in a live Orca, show that a `workspace.create.before` hook that sets `branch` gives exactly that ref, that the hook sees the `name` the plugin passed, that a manual create with another name in the same project keeps Orca's branch, and that a manual create with the same name while the Start is pending makes exactly one of the two creates fail. Record the commands and results in the PR. If the ref is not exact, stop and report on #16 (B1). Verify: the PR description quotes the observed branch names.
- [ ] 1.2 Add the hook to `orca-plugin.json` (`contributes.hooks`, `workspace.create.before`) and its handler in `src/worker.ts`, backed by the in-memory pending map in `Starts` (B1). Verify: `src/worker.test.ts` covers a Start's create getting branch `DIOGEN-449-fix-login-timeout`, a create with another name passing unchanged, a folder create passing unchanged, and the map entry removed after success and after failure; `orca plugin validate .` passes.
- [ ] 1.3 Show `Branch <name>` under `Workspace <name>` in the confirmation (`src/panel.tsx`). Verify: `src/panel.test.tsx` covers "Confirmation shows the branch".

## 2. PR title line

- [ ] 2.1 `buildPrompt` in `src/start.ts` adds the PR-title line before the fence (B3). Verify: `src/start.test.ts` checks that the line is present, sits before `FENCE_HEADER`, and names the key.
- [ ] 2.2 README: Start names the branch after the item, so Plane's Git integration links it. Verify: `bin/check` exits 0; a live Start shows the branch in Orca.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
