# Tasks

## 1. Log

- [x] 1.1 Add the history store to `src/starts.ts` (design H1, H4) with idempotent updates by attempt id, written under `mutate`. Verify: `src/starts.test.ts` covers an append, an update by id done twice (no change), the 10-per-item cap, the 500-item cap, and two Starts of different items at once (both kept).
- [x] 1.2 Append the `pending` attempt in `Starts.start` before the host call (H2); set outcomes in `create`, `recover()` and `reconcile` (H3). Verify: `src/starts.test.ts` covers created; failed; a worker stop after the pending write, then a workspace found on reconcile (`created`); the same, not found in a complete list (`failed`); an attempt whose state was never written (resolved by its own name); and an account switch during `create` (no write).
- [x] 1.3 `history.get` in `src/protocol.ts` and `src/worker.ts`. Verify: `src/worker.test.ts` covers the attempts surviving a worker remount, and an empty list after a disconnect and reconnect.

## 2. Detail

- [x] 2.1 The "Earlier starts" section in the detail (`src/panel.tsx`): newest first, with `RelativeTime`, agent label, project, workspace and an outcome badge (`pending` and `unknown` → "not confirmed"); hidden when there are no attempts. Verify: `src/panel.test.tsx` covers the three "Item detail shows earlier Starts" scenarios; `bin/check` exits 0.
- [x] 2.2 README: one line on the history. Verify: a live check in Orca (start, remove the workspace, reopen the item) shows the entry; screenshot in the PR.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
