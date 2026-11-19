## Why

Coding agents do much worse on vague tickets: a ticket without acceptance criteria or references to code more often yields a pull request that misses the intent (Sayagh, "What Makes a GitHub Issue Ready for Copilot?", arXiv 2512.21426; Atlassian, "Writing tickets for AI agents"). The Start confirmation looks the same for a one-line ticket and a complete one, so the developer finds out after the agent has run (#37).

## What Changes

- The Start confirmation lists readiness hints for the item: no description, a very short description, no checklist, no reference to code or a link.
- Hints are advice: Start stays enabled, and the hints are computed locally, without a network or model call.
- A ticket with none of these problems shows no hints.

Out of scope: rewriting or improving the ticket (that would be writing to Plane, see #8); scoring with a language model.

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the Start confirmation shows readiness hints.

## Impact

- `src/readiness.ts` (new): a pure function from an item's description to a list of hints.
- `src/panel.tsx`: `Confirmation` shows the hints.
- Tests: `src/readiness.test.ts` (new), `src/panel.test.tsx`.
- `README.md`: one line on readiness hints.
- `openspec/changes/start-readiness-hints/tasks.md`: task tracking.
