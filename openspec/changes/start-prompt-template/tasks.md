# Tasks

Planned to land after `branch-from-item-key` and `agent-item-context` (all three touch `buildPrompt`).

## 1. Template

- [ ] 1.1 Add the setting `promptTemplate` to `orca-plugin.json` (string, `multiline: true`, `maxLength: 4000`, default `""`, a description listing the placeholders and suggesting `{key}` in PR titles). Verify: `orca plugin validate .` passes.
- [ ] 1.2 `buildPrompt(item, template = '')` in `src/start.ts` per design T1 and T3; an empty template returns today's default. Verify: `src/start.test.ts` covers all placeholders, no placeholders, missing `{key}`/`{url}`, `{ticket}\n{ticket}` (one block), `Read {ticket} before coding.` (header and footer each a whole line, exactly once), `{ticket}` inside the description, an unknown placeholder, and empty → default.
- [ ] 1.3 `askStart` in `src/panel.tsx` reads the setting (T4) and passes it. Verify: `src/panel.test.tsx` covers "Template with all placeholders" and "Empty template"; `bin/check` exits 0.
- [ ] 1.4 README: the setting and its placeholders, with one example. Verify: a live Start in Orca with a template shows the expected prompt (quoted in the PR).

## Workflow follow-up

- Archive the change after its PR merges into `develop`.
