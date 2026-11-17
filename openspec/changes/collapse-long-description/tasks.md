# Tasks

## 1. Collapse a long description

- [x] 1.1 Add `preview(markdown)` to `src/plane/markdown.ts`: `null` within the limits; else the first whole blocks within them, never splitting a fenced code block; a too-long first block is cut at a word and ends with "…".
  - Verify: `src/plane/markdown.test.ts` covers short, many blocks, a fence with blank lines, one long paragraph and a long list.
- [x] 1.2 The detail in `src/panel.tsx` shows the preview and "Show more" / "Show less"; opening an item resets it to collapsed.
  - Verify: `src/panel.test.tsx` covers the three spec scenarios; `bin/check` exits 0.
