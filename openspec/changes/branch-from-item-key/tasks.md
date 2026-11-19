# Tasks

## 1. Exact branch

- [ ] 1.1 Find out whether host `workspace.create` takes a `branch` (`orca plugin types .`, then read `.orca/types`), and in a live Orca whether the branch keeps exactly the given text; record both answers in the PR description. Verify: the PR says which path of design B1 was taken and why.
- [ ] 1.2 Implement design B1: either pass `branch: name` in `Starts.create`, or add the `workspace.create.before` hook (manifest `contributes.hooks`, handler in `src/worker.ts`, in-memory pending names in `Starts`) that sets `branch` only for a create whose name and project match a pending Start. Verify: `src/starts.test.ts` (or `src/worker.test.ts` for the hook) checks that the create gets branch `DIOGEN-449-fix-login-timeout`, and that a create the plugin did not start passes unchanged.
- [ ] 1.3 Show `Branch <name>` under `Workspace <name>` in the confirmation (`src/panel.tsx`). Verify: `src/panel.test.tsx` covers "Confirmation shows the branch".

## 2. PR title line

- [ ] 2.1 `buildPrompt` in `src/start.ts` adds the PR-title line before the fence (design B3). Verify: `src/start.test.ts` checks that the line is present, sits before `FENCE_HEADER`, and names the key.
- [ ] 2.2 README: say that Start names the branch after the item, so Plane's Git integration links it. Verify: `bin/check` exits 0; a live Start shows the branch in Orca.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
