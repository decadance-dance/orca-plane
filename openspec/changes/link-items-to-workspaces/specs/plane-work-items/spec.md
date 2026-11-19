## ADDED Requirements

### Requirement: Show the agent state of a linked item
For an item linked to an existing workspace, the list row and the item detail SHALL show the latest known state of the agent in that workspace: "Working", "Needs input" (Orca's blocked or waiting) or "Done". When no state has been reported since the plugin started, nothing SHALL be shown. The row SHALL update when the state changes, without a refresh from Plane.

#### Scenario: Agent waits for input
- **WHEN** the agent in an item's linked workspace reports that it is waiting for input
- **THEN** the item's row shows "Needs input"

#### Scenario: Agent finishes
- **WHEN** the agent in an item's linked workspace reports done
- **THEN** the item's row and detail show "Done"

#### Scenario: Unlinked workspace
- **WHEN** an agent reports a state in a workspace that no item is linked to
- **THEN** no row changes

#### Scenario: No state known yet
- **WHEN** an item has a linked workspace and no agent state has been reported since the plugin started
- **THEN** its row shows no agent state

### Requirement: Follow the focused workspace
When the focused Orca workspace changes to one that is linked to an item, the panel SHALL show that item's detail. An open Start confirmation SHALL stay open. Focusing an unlinked workspace, or an event that leaves the same workspace focused, SHALL leave the panel as it is.

#### Scenario: Switch to a linked workspace
- **WHEN** the user focuses the workspace that was started from `DIOGEN-449`
- **THEN** the panel shows the detail of `DIOGEN-449`

#### Scenario: Switch to an unlinked workspace
- **WHEN** the user focuses a workspace that no item is linked to
- **THEN** the panel keeps showing what it showed

#### Scenario: Back in the list
- **WHEN** the panel follows to an item, and the user goes back to the list while the same workspace stays focused
- **THEN** the panel stays on the list until another linked workspace is focused

## MODIFIED Requirements

### Requirement: Status bar count
While connected, the status bar SHALL show the number of my open items when the list is complete, and `?` otherwise. When agents in workspaces linked to items need input, it SHALL also show their number after the count, in a warning tone, and its tooltip SHALL say how many agents wait. It SHALL show nothing while disconnected. Pressing it SHALL toggle Orca's right sidebar, where the Plane panel lives. It SHALL refresh on the configured interval: at least 5 minutes, 10 by default.

#### Scenario: Complete list
- **WHEN** the list is complete with 12 items
- **THEN** the status bar shows 12

#### Scenario: Partial list
- **WHEN** the list is partial or stale
- **THEN** the status bar shows `?`

#### Scenario: Disconnected
- **WHEN** no connection exists
- **THEN** the status bar shows nothing and no background refresh runs

#### Scenario: Agents need input
- **WHEN** the list is complete with 12 items and the agents of 2 linked workspaces need input
- **THEN** the status bar shows `12 · 2 waiting` in a warning tone, without waiting for the next refresh

#### Scenario: The waiting agent goes on
- **WHEN** the only waiting agent reports working again
- **THEN** the status bar shows just the count, in its normal tone
