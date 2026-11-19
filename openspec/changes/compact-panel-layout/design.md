## Context

The panel layout is design D10 of `add-plane-work-items` (archived 2026-11-17). Issue #66 replaces most of it with the layout the maintainer chose on 2026-11-19: mockup A for the list and mockup B for the detail, followed point by point within Orca's components. Orca's components panel API sets the limits: no custom CSS, five tones, a pressable `ListItem` cannot hold other controls, a `Box` cannot be pressed, `Text` has three sizes and no monospace face, `KeyValue` takes only text, and only `danger` colours a button.

## Goals / Non-Goals

**Goals:** one line per item at sidebar width; a project switcher that never wraps; search and tag filter out of the way until asked for; a detail whose actions sit above the description.

**Non-Goals:** new data (no Plane request is added or changed); new filters.

## Decisions

### P1. Header
`Plane` and the muted `user · slug` on the left. On the right: icon buttons Search (`search`), Filter (`filter`), Refresh (`refresh`) and `⋯` (`more`). The `⋯` toggle shows, under the header, the "Open by key or URL" field, its refusal, and a small ghost Disconnect button, above the list, so it is there while the first list loads; that part stays shown while the field holds text or a refusal. The toggles are named by what they do ("Show search" / "Hide search", "Show filters", "Show actions"); the search field keeps the name "Search". A toggle whose part is shown is drawn `outline`, otherwise `ghost`; one whose part holds a value is disabled, since pressing it could not hide the part. The detail has no list header (P9).

### P2. Project picker
One `Select` named "Plane project" (the label is hidden; "Project" is the Orca project of a Start). Options are the projects with listed items, ordered by name, each `<PREFIX> · <n> items` (`1 item`), where n counts the project's items that pass the search and the tags. The value, its persistence (`plane.tab`) and the fallback to the first project are those of D10's tabs; only the control changes. A `Select` never wraps, and the count stays visible in the closed picker. Orca's `Select` drops every option past 500, so the picker offers the first 500 projects by name (a `limit:` in the code); items in more than 500 projects at once are not expected.

### P3. Search behind its icon
The search field shows while the Search icon is toggled on or while the field holds text, so a remembered search is never hidden. The toggle lives in the panel run only. Hiding the field does not clear the text.

### P4. Filter strip
The Filter icon shows a strip of tags under the search: the priorities present in the loaded list (urgent, high, medium, low; none has no tag), then its labels by name, plus any active tag no longer present, so a remembered tag can always be turned off. The list is the whole loaded list, not the selected project, as the filter applies to every project. The strip stays shown while a tag is active. A tag keeps D10's look (a ghost button in a rounded box outlined in its tone, the priority's tone or grey for labels); an active one is filled (its tone, or `accent` for a grey label, since a `muted` fill did not show against the panel, #64) and carries a check icon, which reads as active in both themes whatever the tone.

### P5. State groups
A plain header line per state: the state's name as a level-3 `Heading`, which Orca draws small, upper case and muted, and its count muted on the right; a `Separator` between groups. The order is D10's. Groups no longer collapse: the rows are one line each, so a group is short, and a collapsed group hid items without a filter saying so.

### P6. One-line row
A `List` per row holding one pressable `ListItem` (keyed by the item's key) that opens the item, and beside it, outside it, the Start / Open workspace icon button (D10). Inside the `ListItem`, one line: the priority dot `●` in its tone (`○` muted for none), the key in `xs` muted text in a column as wide as the longest key, and the title in `sm` medium weight, truncated. Orca has no monospace `Text`, and `Code` draws a chip too heavy for every row, so the column is sized at about 7 px a character of the longest key (a `limit:` in the code). The row carries no badges, labels or update time: the labels and update time are in the detail and the labels in the filter strip; the agent state and a failed Start are the icon (P7). Orca refuses a panel of more than 5000 nodes, and the fetch cap is 1000 items, so a row spends as few nodes as it can and the list draws at most 250 rows of the selected project, then the line "Showing 250 of <n>. Search or filter to see the rest." (On `develop` a list of about 450 rows already left the panel blank.)

### P7. Agent state as the row's icon
The workspace icon of a linked row shows the agent's state: `agent` (working, neutral), `bell` (needs input, warning), `check` (done, success), else `open-external`. It is named "Open workspace · Agent working", "· Agent needs input" or "· Agent done", so the state reads as the agent's, not the item's Plane state (#62). A failed Start draws a danger `warning` icon instead ("Start failed · Start again", or "Open workspace · The agent did not start" when its workspace exists). The detail shows the state as its "Agent" field (P9). A badge on the row left the title two or three words at sidebar width.

### P8. Completeness named once
No completeness badge. The list shows "updated <relative time>", centred at the bottom, whenever it has data; a complete list shows nothing else about it. A partial, stale or failed list shows one line of `sm` text in the warning or danger tone, `<State> · <reason>` (the reason when there is one), above the list. The badge and the banner of the earlier layout named the state twice (#63); a `Callout` without a title still draws Orca's own "Warning", so the line is plain text.

### P9. Detail
No list header: the detail starts with a ghost "← All items" button (Orca has no back icon). Then a muted, framed `Box`: the key (muted) on the left and the priority as an outlined pill on the right (a `Box` outlined in its tone with `xs` text; "No priority" in grey; Orca's `Badge` is filled), the title as a level-2 heading, and label/value rows for State, Assignees, Labels, Updated (relative to now) and, when known, Agent ("Working", "Needs input", "Done" in its tone). The rows are `Box`es, since `KeyValue` takes only text and cannot hold a `RelativeTime`. Then the action row: Start work (or Starting…, Checking…, Open workspace) as a `solid` button that fills the row, and an outline button "Plane" with the tooltip "Open in Plane" at its own size (the mockup's label; an Orca `Button` is named by its text and takes no separate accessible name). Below it: a failed Start's banner, an Open workspace error, and the Start confirmation, which replaces the Start button as before. Then the description, unframed, with Show more / Show less, and the earlier Starts. A closed item shows no Start, as before.

## Risks / Trade-offs

- **The row hides labels and update time.** → Both are one press away in the detail; the labels are in the filter strip.
- **The agent state is an icon only.** → Its tooltip and accessible name spell it out, and the detail names it in words.
- **Open by key and Disconnect sit behind `⋯`.** → The part stays shown while it holds text or a refusal, so nothing typed is hidden.
- **Orca draws some of the mockup differently** (as of Orca 1.4.262): an `accent` `IconButton` is not coloured (only `danger` is), a `solid` `Button` is a grey fill rather than the mockup's primary colour, there is no monospace text, no back icon, no fade on a collapsed description, `Select` options are plain text, and the `low` tag's `success` outline draws grey (#64).
- **Overlap with PR #65 (`src/panel.check.ts`).** → This change carries #65's scenarios; `web-tab` is renamed `web-project`.

## Migration Plan

The persisted keys (`plane.tab`, `plane.tags`, `plane.search`) keep their meaning, so nothing migrates.
