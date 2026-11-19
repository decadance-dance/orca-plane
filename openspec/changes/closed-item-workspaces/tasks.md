# Tasks

## 1. Worker

- [ ] 1.1 `failed` states keep an optional `name` (`src/protocol.ts`, `Starts.create`), per design C3. Verify: `src/starts.test.ts` covers an agent failure after the workspace exists (the name is kept) and an old record without a name (still valid).
- [ ] 1.2 The hidden set, `Starts.hide(key)`, cleanup in `reconcile`, and `starts.get` returning `{ states, hidden }`; `start.hide` in `src/protocol.ts` and `src/worker.ts` (C2). Verify: `src/starts.test.ts` covers hide, hide surviving a worker remount, Start still refused for a hidden key with an existing workspace, and the hidden mark removed when the workspace is gone.

## 2. Section

- [ ] 2.1 The section in `ListView` (`src/panel.tsx`) per C1 and C4; adapt every consumer of `starts.get` to `{ states, hidden }` (the panel's reader, `src/panel.check.ts`, the worker and panel tests) while `Starts.all()` stays a bare map (C2). Verify: `src/panel.test.tsx` covers the five "Show workspaces of items no longer open" scenarios and the three "Hide a leftover workspace" scenarios; `bin/check` exits 0.
- [ ] 2.2 README: one line on the section. Verify: a live check in Orca (start an item, close it in Plane, refresh) shows the section; screenshot in the PR.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
