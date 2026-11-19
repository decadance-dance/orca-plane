## Context

The panel layout is design D10 of `add-plane-work-items` (archived 2026-11-17). Issue #66 replaces most of it with the layout the maintainer chose on 2026-11-19. Orca's components panel API sets the limits: no custom CSS, five tones, a pressable `ListItem` cannot hold other controls, a `Box` cannot be pressed, and `Text` has three sizes.

## Goals / Non-Goals

**Goals:** one line per item at sidebar width; a project switcher that never wraps; search and tag filter out of the way until asked for; a detail whose actions sit above the description.

**Non-Goals:** new data (no Plane request is added or changed); new filters; moving the "Open by key or URL" field.

## Decisions

### P1. Header
`Plane` and the muted `user · slug` on the left. On the right, on the list: icon buttons Search (`search`), Filter (`filter`) and Refresh (`refresh`), then the Disconnect button. The detail shows only Refresh and Disconnect: Search and Filter act on the list. The Search and Filter icons are named "Show search" / "Hide search" and "Show filters" / "Hide filters" by what they do; the search field keeps the name "Search". An icon whose part is shown is drawn `outline`, otherwise `ghost`.

### P2. Project picker
One `Select` named "Plane project" (the label is hidden; "Project" is the Orca project of a Start). Options are the projects with listed items, ordered by name, each `<PREFIX> · <n>`, where n counts the project's items that pass the search and the tags. The value, its persistence (`plane.tab`) and the fallback to the first project are those of D10's tabs; only the control changes. A `Select` never wraps, and the count stays visible in the closed picker.

### P3. Search behind its icon
The search field shows while the Search icon is toggled on or while the field holds text, so a remembered search is never hidden. The toggle lives in the panel run only. Hiding the field does not clear the text.

### P4. Filter strip
The Filter icon shows a strip of tags under the search: the priorities present in the loaded list (urgent, high, medium, low; none has no tag), then its labels by name, plus any active tag no longer present, so a remembered tag can always be turned off. The list is the whole loaded list, not the selected project, as the filter applies to every project. The strip stays shown while a tag is active. A tag keeps D10's look (a ghost button in a rounded box outlined in its tone, the priority's tone or grey for labels); an active one is filled (its tone, or `accent` for a grey label, since a `muted` fill did not show against the panel, #64) and carries a check icon, which reads as active in both themes whatever the tone.

### P5. State groups
A plain header line per state, the state's name in `xs` semibold and its count muted on the right, and a `Separator` between groups. The order is D10's. Groups no longer collapse: the rows are one line each, so a group is short, and a collapsed group hid items without a filter saying so.

### P6. One-line row
A `List` per row holding one pressable `ListItem` (keyed by the item's key) that opens the item, and beside it, outside it, the Start / Open workspace icon button (D10). Inside the `ListItem`, one line: the priority dot `●` in its tone (`○` muted for none), the key in `xs` muted text, the title truncated, then the "Start failed" and agent badges when they apply. Orca has no monospace `Text`; `Code` draws a chip, too heavy for every row, so the key is plain muted text. The row no longer shows its labels or update time: both are in the detail, and the labels are in the filter strip.

### P7. Agent badge names the agent
"Agent working", "Agent needs input", "Agent done", tones unchanged. The bare "Done" read as the item's Plane state next to its state group (#62). The wording is the option #62 suggested.

### P8. Completeness named once
The status line keeps the badge and the update time. The banner of a partial, stale or failed list repeated the badge in its title (#63). A `Callout` without a title still draws Orca's own ("Warning"), so the reason becomes one line of `sm` text in the warning or danger tone.

### P9. Detail
From the top: the back control; a muted, framed `Box` with the key (muted) and the priority badge (its tone; "No priority" in grey) on one line, the title as a level-2 heading, and a `KeyValue` of State, Assignees, Labels and Updated; the action row with Start (or Starting…, Checking…, Open workspace) as the primary accent button and Open in Plane as an outline button. Below the action row: the agent badge, a failed Start's banner, an Open workspace error, and the Start confirmation, which replaces the Start button as before. Then the description (framed, Show more / Show less) and the earlier Starts. A closed item shows no Start, as before.

## Risks / Trade-offs

- **The row hides labels and update time.** → Both are one press away in the detail; the labels are in the filter strip.
- **The agent badge is wider.** → The title truncates first; the icon keeps its size, so the row never overflows.
- **Overlap with PR #65 (`src/panel.check.ts`).** → This change carries #65's scenarios; whichever merges second rebases.

## Migration Plan

The persisted keys (`plane.tab`, `plane.tags`, `plane.search`) keep their meaning, so nothing migrates.
