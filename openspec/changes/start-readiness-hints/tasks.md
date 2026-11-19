# Tasks

## 1. Readiness rules

- [ ] 1.1 Check that Plane's checklist HTML (`<ul data-type="taskList">` with `<li data-checked>`) converts to `- [ ]` or `- [x]` in `htmlToMarkdown`; add a fixture to `src/plane/markdown.test.ts` and fix the converter if it does not. Verify: the fixture passes.
- [ ] 1.2 Add `src/readiness.ts` with `readiness(description)` per design R1. Verify: `src/readiness.test.ts` covers empty (only one hint), short, no checklist, no reference, a path, inline code, a link, and a ready ticket (no hints).

## 2. Confirmation

- [ ] 2.1 `Confirmation` in `src/panel.tsx` renders the hints as one warning Callout above the prompt (design R2); Confirm stays enabled. Verify: `src/panel.test.tsx` covers the three "Readiness hints before Start" scenarios; `bin/check` exits 0.
- [ ] 2.2 README: one line on readiness hints. Verify: the README renders; a live check in Orca on an item with an empty description shows the Callout (screenshot in the PR).

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
