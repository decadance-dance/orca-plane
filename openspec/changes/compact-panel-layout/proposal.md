## Why

The list spends two to four lines on each item (title, a meta line, a row of tags) and wraps each state in a collapsible card, so a narrow sidebar shows about four items. The project switcher wraps into several lines once there are a few projects. The detail opens with a heading and a plain key/value table, with Start at the bottom, after the description (#66). The maintainer compared three mockups and chose a one-line list and a framed detail header (decisions of 2026-11-19, recorded in #66).

## What Changes

- The header carries icon buttons for Search, Filter and Refresh, then Disconnect.
- The project tabs become one project picker (`Select`); each option reads `<PREFIX> · <n>`, n being the project's matching items. The rules stay: remembered, no all-projects entry, the first project when the remembered one has no items.
- The search field opens from the Search icon and stays shown while it holds text.
- The tags leave the rows. The Filter icon opens a strip of the priorities and labels present in the loaded list, as pressable tags with today's rules; it stays shown while a tag is active. An active tag is filled and checked, so it reads as active in both themes (#64).
- State groups are plain header lines (state name, count) with a separator between groups, in today's order, and no longer collapse.
- A row is one line: the priority as a dot in its tone, the key, the truncated title, the Start failed and agent badges when they apply, and the Start / Open workspace icon.
- The agent badge names the agent: "Agent working", "Agent needs input", "Agent done", so it no longer reads as the item's state (#62).
- A partial, stale or failed list names its state once: the banner below the badge carries only the reason (#63).
- The detail opens with a muted, framed header (key and priority badge, title, State, Assignees, Labels, Updated), then an action row (Start or Open workspace, and Open in Plane), then the agent state, a failed Start and the Start confirmation, then the description and the earlier Starts.

Out of scope: the "Open by key or URL" field stays where it is, always shown; any change to how the list is fetched, sorted or filtered.

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: the project tabs become a project picker; state groups no longer collapse; tags move from the rows to a filter strip; the search field may sit behind a toggle; the row and the detail get a compact layout; the agent badge names the agent.

## Impact

- `src/panel.tsx`: header, project picker, search and filter toggles, filter strip, group headers, one-line rows, framed detail header and action row, agent badge labels, completeness banner.
- `src/panel.check.ts`: the rendered scenarios, including the row decorations and the detail of a linked item (it folds in the scenarios of PR #65).
- `src/panel.test.tsx`: the list, tab, tag, group and detail tests follow the new layout.
