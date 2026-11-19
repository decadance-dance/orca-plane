# Tasks

## 1. Forget

- [ ] 1.1 `Starts.forget(key)` per design C2, plus `start.forget` in `src/protocol.ts` and `src/worker.ts`. Verify: `src/starts.test.ts` covers forgetting created and failed links, refusing pending and unknown, and that a worker remount keeps it forgotten.

## 2. Section

- [ ] 2.1 The section in `ListView` (`src/panel.tsx`) per C1 and C3. Verify: `src/panel.test.tsx` covers the three "Show workspaces of items no longer open" scenarios and the two "Forget a link" scenarios; `bin/check` exits 0.
- [ ] 2.2 README: one line on the section. Verify: a live check in Orca (start an item, close it in Plane, refresh) shows the section; screenshot in the PR.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
