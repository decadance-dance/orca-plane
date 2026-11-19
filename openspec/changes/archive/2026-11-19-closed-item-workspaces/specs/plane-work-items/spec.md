## ADDED Requirements

### Requirement: Show workspaces of items no longer open
When the list is complete, the panel SHALL show, below the tabs, a collapsible section listing each existing linked workspace whose item is not in the list and that the user has not hidden. Each entry SHALL show the item key, the workspace name when the plugin knows it, and "Open workspace". The section SHALL be hidden when it would be empty, and while the list is partial, stale or failed.

#### Scenario: Item finished in Plane
- **WHEN** the item `DIOGEN-449` with a linked workspace is moved to Done in Plane and the complete list is refreshed
- **THEN** `DIOGEN-449` leaves its tab, and the section lists `DIOGEN-449` with its workspace name and "Open workspace"

#### Scenario: Agent failed after the workspace was created
- **WHEN** a Start created the workspace `DIOGEN-449-fix-login-timeout` but its agent failed to start, and the item then leaves the list
- **THEN** the section lists `DIOGEN-449` with the workspace name `DIOGEN-449-fix-login-timeout`

#### Scenario: Link saved without a workspace name
- **WHEN** a link saved by an earlier version of the plugin has no workspace name
- **THEN** its entry shows the item key and "Open workspace" without a name

#### Scenario: Partial list
- **WHEN** the list is partial and a linked item is not in it
- **THEN** the section is not shown

#### Scenario: Open the leftover workspace
- **WHEN** the user presses "Open workspace" in the section
- **THEN** Orca shows that workspace

### Requirement: Hide a leftover workspace
Each entry in the section SHALL offer "Hide", which removes the entry from the section and keeps the item's link to the workspace, so Start stays refused for that item while the workspace exists. Hiding SHALL hold across panels and worker restarts, and SHALL end when the link ends.

#### Scenario: Hide a leftover
- **WHEN** the user presses "Hide" on `DIOGEN-449` in the section
- **THEN** the entry disappears, and the workspace still exists in Orca

#### Scenario: Hidden item comes back
- **WHEN** a hidden item is assigned to the user again and is open
- **THEN** it is listed with "Open workspace", not Start

#### Scenario: Workspace removed in Orca
- **WHEN** the user removes a hidden item's workspace in Orca
- **THEN** the link and the hiding both end, and the item offers Start again when it is open
