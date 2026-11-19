## ADDED Requirements

### Requirement: Start prompt follows the user's template
The plugin SHALL offer a multi-line setting for a Start prompt template with the placeholders `{key}`, `{url}` and `{ticket}`. A non-empty template SHALL replace the default instructions of the Start prompt, and its first `{ticket}` SHALL become the fenced ticket block. An empty template SHALL give the default prompt. The prompt SHALL stay editable in the confirmation.

#### Scenario: Template with all placeholders
- **WHEN** the template is "Read AGENTS.md first. Item {key} ({url}).\n{ticket}\nOpen a PR titled with {key}." and the user starts `DIOGEN-449`
- **THEN** the confirmation's prompt is that text with the key, the item's URL and the fenced ticket block in place of the placeholders

#### Scenario: Empty template
- **WHEN** the template setting is empty
- **THEN** the confirmation's prompt is the default prompt

### Requirement: A template cannot drop or break the ticket block
Whatever the template says, the Start prompt SHALL contain the fenced ticket block exactly once, with its header and footer each on a whole line, and the item key and URL. Only the first `{ticket}` SHALL become the block; with none, the block SHALL be appended. When `{key}` or `{url}` is missing, a first line SHALL name both. Placeholders SHALL be replaced in one pass.

#### Scenario: Template without the ticket placeholder
- **WHEN** the template is "Follow AGENTS.md." with no placeholders
- **THEN** the prompt starts with a line naming the key and URL, then "Follow AGENTS.md.", and ends with the fenced ticket block

#### Scenario: Two ticket placeholders
- **WHEN** the template is "{ticket}\n{ticket}"
- **THEN** the prompt contains the block once

#### Scenario: Placeholder inside a sentence
- **WHEN** the template is "Read {ticket} before coding."
- **THEN** the block's header and footer each stand on a line of their own, with "Read" before the block and "before coding." after it

#### Scenario: Ticket text holds a placeholder
- **WHEN** the item's description contains the text `{ticket}`
- **THEN** that text appears unchanged inside the block, and the block appears once
