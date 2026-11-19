## Why

The list spends two to four lines on each item (title, a meta line, a row of tags) and wraps each state in a collapsible card, so a narrow sidebar shows about four items. The project switcher wraps into several lines once there are a few projects. The detail opens with a heading and a plain key/value table, with Start at the bottom, after the description (#66). The maintainer compared three mockups and chose mockup A for the list and mockup B for the detail, then asked for every remaining difference to be closed (decisions of 2026-11-19, recorded in #66).

## What Changes

- The header carries icon buttons for Search, Filter, Refresh and `⋯`; the "Open by key or URL" field and Disconnect move behind `⋯` and stay shown while the field holds text or a refusal.
- The project tabs become one project picker (`Select`); each option reads `<PREFIX> · <n> items`, n being the project's matching items. The rules stay: remembered, no all-projects entry, the first project when the remembered one has no items.
- The search field opens from the Search icon and stays shown while it holds text.
- The tags leave the rows. The Filter icon opens a strip of the priorities and labels present in the loaded list, as pressable tags with today's rules; it stays shown while a tag is active. An active tag is filled and checked, so it reads as active in both themes (#64).
- State groups are small upper-case headers (state name, count) with a separator between groups, in today's order, and no longer collapse.
- A row is one line: the priority as a dot in its tone, the key in an aligned column, the truncated title, and the Start / Open workspace icon. No badges: the icon shows the agent's state (agent, bell, check) and a failed Start (a danger warning), and is named for it.
- The agent state is named as the agent's: "Agent working", "Agent needs input", "Agent done" on the row's icon, an "Agent" field in the detail, so it no longer reads as the item's state (#62).
- No completeness badge: a complete list shows "updated …" at the bottom; a partial, stale or failed list names its state once, as one line `<State> · <reason>` in its tone (#63).
- The detail drops the list header and opens with "← All items", then a muted, framed header (key, an outlined priority pill, title, State, Assignees, Labels, Updated relative to now, Agent), then an action row (Start work or Open workspace filling the row, and a "Plane" button named "Open in Plane"), then a failed Start and the Start confirmation, then the description, unframed, and the earlier Starts.

Out of scope: any change to how the list is fetched, sorted or filtered.

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the project tabs become a project picker; state groups no longer collapse; tags move from the rows to a filter strip; the search field may sit behind a toggle; the row and the detail get a compact layout; the agent state shows as the row's icon and the detail's Agent field; completeness is named once; Open by key or URL may sit behind a header control.

## Impact

- `src/panel.tsx`: header and its `⋯` part, project picker, search and filter toggles, filter strip, group headers, one-line rows with the agent state icon, framed detail header and action row, completeness line.
- `src/panel.check.ts`: the rendered scenarios, including the row decorations and the detail of a linked item (it folds in the scenarios of PR #65).
- `src/panel.test.tsx`: the list, tab, tag, group and detail tests follow the new layout.
