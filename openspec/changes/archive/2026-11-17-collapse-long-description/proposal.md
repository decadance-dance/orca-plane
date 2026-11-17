## Why

The item detail shows the whole description at once. A long description pushes the rest of the detail (the Start control, a failed Start's message) far down the narrow sidebar, and the user scrolls past text they may not need (#26).

## What Changes

- A long description opens collapsed: the detail shows its first whole blocks (paragraphs, lists, code blocks) up to about 500 characters and 10 lines, and a "Show more" button.
- "Show more" shows the whole description; "Show less" collapses it again. Each opened item starts collapsed.
- A description within those limits shows in full, without the button.
- A first block that alone exceeds the limits is cut at a word and ends with "…", so the preview never shows the whole long text.

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the item detail collapses a long description.

## Impact

- `src/plane/markdown.ts`: a `preview` function that picks the collapsed part of a Markdown description.
- `src/panel.tsx`: the detail shows the preview and the toggle button.
- Tests: `src/plane/markdown.test.ts`, `src/panel.test.tsx`.
