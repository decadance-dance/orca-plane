## Why

Every Start sends the same built-in instructions around the ticket. A developer who wants each agent to follow the project's routine (read AGENTS.md, open a PR with the item key, run the checks) types it into the prompt on every Start, and agents run inconsistently when they forget (#38).

## What Changes

- A new plugin setting, "Start prompt template" (multi-line), shapes the instructions of the Start prompt with the placeholders `{key}`, `{url}` and `{ticket}`.
- The fenced ticket block is always in the prompt: at `{ticket}`, or appended at the end when the template leaves it out. The item key and URL are always in the prompt too.
- Placeholders are replaced in one pass, so ticket text that contains `{key}` or `{ticket}` is never expanded.
- An empty template gives the default prompt. The confirmation still lets the user edit the prompt before Start.

Out of scope: a template per Orca project (#43); placeholders for ticket fields outside the fence (see design T2).

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the Start prompt follows a configurable template.

## Impact

- `orca-plugin.json`: setting `promptTemplate` (string, multiline, maxLength 4000, default empty).
- `src/start.ts`: `buildPrompt(item, template)`.
- `src/panel.tsx`: `askStart` reads the setting and passes it.
- Tests: `src/start.test.ts`, `src/panel.test.tsx`.
