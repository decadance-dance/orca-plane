# Tasks

## 1. List

- [x] 1.1 Header icons Search, Filter, Refresh and `⋯` (Open by key or URL, Disconnect); the search field behind its icon (P1, P3). Verify: `src/panel.test.tsx` covers the toggle, a remembered search keeping the field shown, and the detail without the two icons.
- [x] 1.2 Project picker `Select` with counts (P2). Verify: the tab tests in `src/panel.test.tsx` read the picker's options and value; remembered and fallback cases pass.
- [x] 1.3 Filter strip with active fill and check (P4). Verify: `src/panel.test.tsx` covers the strip's tags, a remembered tag keeping it shown, a remembered tag no longer present, and the fill of an active label.
- [x] 1.4 Plain group headers with counts and separators (P5); one-line rows with dot, key column, title and icon (P6). Verify: the group order test and a row test in `src/panel.test.tsx`.
- [x] 1.5 Agent state as the row's icon and the detail's Agent field (P7); completeness named once (P8). Verify: the agent state and completeness tests in `src/panel.test.tsx`.

## 2. Detail

- [x] 2.1 Framed header and the action row above the description (P9). Verify: the detail tests in `src/panel.test.tsx`.

## 3. Check

- [x] 3.1 `src/panel.check.ts` scenarios show the new layout at sidebar width, with the row decorations of PR #65 (`web-project`, `tags`, `detail-linked`, `start-failed`) and a filter-open scenario. Verify: `bin/check` exits 0; `orca plugin shot . --scenario <name> --width 320` for the list, tags, partial and detail scenarios looks right.
- [x] 3.2 `openspec validate --all` passes.

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
