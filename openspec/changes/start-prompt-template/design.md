## Context

`buildPrompt(item)` in `src/start.ts` returns fixed instructions plus `fence(...)`; the panel puts it into the confirmation's editable Textarea (`askStart` in `src/panel.tsx`). Orca plugin settings support `multiline` strings (`references/manifest.md`, SettingContribution). `branch-from-item-key` adds the PR-title line to the default instructions, and `agent-item-context` adds fields to the block; this change is planned to land after both.

## Goals / Non-Goals

**Goals:** a project routine in every Start prompt without retyping it; the safety of the fence kept no matter what the template says.

**Non-Goals:** templates per project; a template language with conditionals.

## Decisions

### T1. One-pass substitution, the block on its own lines
First, the template text goes through the same `escapeFence` as ticket text, so a template line equal to `FENCE_HEADER` or `FENCE_FOOTER` gets its leading `\` and can never pose as a real fence line. Then one `replace(/\{(key|url|ticket)\}/g, …)` pass with a callback. `{key}` and `{url}` become their values. The first `{ticket}` becomes `\n${block}\n`, and every later one becomes the empty string. The replacement values are never scanned again, so `{ticket}` inside the description stays literal. Unknown `{…}` stays as typed. After the pass, blank lines left directly around the block are collapsed to one newline on each side. The header and footer therefore always start and end a line, whatever text surrounded the token, and a test asserts that `FENCE_HEADER` and `FENCE_FOOTER` each appear exactly once as whole lines.

### T2. No ticket fields outside the fence
There is no `{title}` placeholder: the title is ticket text, and outside the fence it would be an unfenced instruction channel (the same reasoning as A2 in `agent-item-context`). The title is in the block.

### T3. Guarantees are added, not validated away
If the template lacks `{ticket}`, the block is appended after a blank line. If it lacks `{key}` or `{url}`, the line `Work on Plane work item ${key}: ${url}` comes first. The setting is never refused; the result is always a safe prompt.

### T4. Read the setting when the confirmation opens
`askStart` calls `settings.get('promptTemplate')` together with the item detail, so a changed setting applies to the next confirmation without a reload.

## Risks / Trade-offs

- [A template drops the PR-title line of the default] → that is the user's choice; the setting's description suggests `{key}` in the PR title.
- [A long template plus the 12,000 character block] → the setting is capped at 4000 characters; the block keeps its own cap.
