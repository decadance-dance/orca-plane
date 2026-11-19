## Context

The confirmation (`Confirmation` in `src/panel.tsx`) already loads the item detail; `ItemDetail.description` is Markdown converted from Plane's HTML (`src/plane/markdown.ts`, D11 in the archived design). See proposal.md for why.

## Goals / Non-Goals

**Goals:** cheap, explainable, deterministic hints.

**Non-Goals:** a score or a rating; blocking Start; per-team tuning of the rules.

## Decisions

### R1. A pure `readiness(description: string): Hint[]` on the Markdown
Four checks, in this order, with a fixed message each:
- `empty`: the trimmed description is empty. When it holds, only this hint is returned, because the other three would repeat it.
- `short`: under 200 characters after removing Markdown syntax (count the text, not the markup).
- `no-checklist`: no line outside fenced code blocks (also fenced blocks inside a quote) matching `^\s*[-*]\s+\[[ xX]\]`. Plane task lists convert to this form; task 1.1 checks that in `markdown.test.ts` fixtures.
- `no-reference`: no inline code, no fenced block, no path-like token (`\b[\w.-]+/[\w./-]+\.\w+\b`) and no `http(s)://` link (the scheme in any case).

Alternative: a weighted score. Rejected: a number invites arguing with it, and a list says what to fix.

### R2. Shown as one warning Callout above the prompt
The heading reads "This ticket may be hard for an agent", followed by one line per hint. With no hints nothing is rendered. Confirm stays enabled.

## Risks / Trade-offs

- [False positives, such as a good ticket that has no checklist] → hints are advice, worded "may", and never block.
- [Plane's HTML for checklists differs from the expected Markdown] → task 1.1 adds a converter fixture; if the converter drops the checkbox, fix the converter in the same task.
