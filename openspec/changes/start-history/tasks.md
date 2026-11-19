# Tasks

## 1. Log

- [ ] 1.1 Add the history store to `src/starts.ts` (design H1, H3), written under a lock. Verify: `src/starts.test.ts` covers an append, the 10-per-item cap, the 500-item cap, and two outcomes written at once (both kept).
- [ ] 1.2 Write entries on the outcome in `create` and patch them in `reconcile` (H2). Verify: `src/starts.test.ts` covers created, failed, unknown → created, unknown → dropped (`failed`), and that a failing history write leaves the Start outcome intact.
- [ ] 1.3 `history.get` in `src/protocol.ts` and `src/worker.ts`. Verify: `src/worker.test.ts` covers the entries surviving a worker remount, and an empty list after a disconnect and reconnect.

## 2. Detail

- [ ] 2.1 The "Earlier starts" section in the detail (`src/panel.tsx`), newest first, with `RelativeTime`, agent label, project, workspace and outcome badge; hidden when there are no entries (H4). Verify: `src/panel.test.tsx` covers the three "Item detail shows earlier Starts" scenarios; `bin/check` exits 0.
- [ ] 2.2 README: one line on the history. Verify: a live check in Orca (start, remove the workspace, reopen the item) shows the entry; screenshot in the PR.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
