# Tasks

## 1. Collapse a long description

- [x] 1.1 Add `preview(markdown)` to `src/plane/markdown.ts`: `null` within the limits; else the first whole blocks within them, never splitting a fenced code block; a too-long first block is cut at a word and ends with "…".
  - Verify: `src/plane/markdown.test.ts` covers short, many blocks, a fence with blank lines, one long paragraph and a long list.
- [x] 1.2 The detail in `src/panel.tsx` shows the preview and "Show more" / "Show less"; opening an item resets it to collapsed.
  - Verify: `src/panel.test.tsx` covers the three spec scenarios; `bin/check` exits 0.
- [x] 1.3 A heading never ends the preview: `preview` drops trailing headings, and when nothing whole fits it cuts the first block of text under its own heading, if that heading leaves room for the text (#30).
  - Verify: `src/plane/markdown.test.ts` covers a heading before a long paragraph, a heading after a short one, a long word, a heading too long to leave room and several leading headings; `bin/check` exits 0.
