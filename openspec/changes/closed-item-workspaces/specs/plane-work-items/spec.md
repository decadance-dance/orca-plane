## ADDED Requirements

### Requirement: Show workspaces of items no longer open
When the list is complete, the panel SHALL show, below the tabs, a collapsible section listing each existing linked workspace whose item is not in the list, with the item key, the workspace name, and "Open workspace". The section SHALL be hidden when it would be empty, and while the list is partial, stale or failed.

#### Scenario: Item finished in Plane
- **WHEN** the item `DIOGEN-449` with a linked workspace is moved to Done in Plane and the complete list is refreshed
- **THEN** `DIOGEN-449` leaves its tab, and the section lists `DIOGEN-449` with its workspace name and "Open workspace"

#### Scenario: Partial list
- **WHEN** the list is partial and a linked item is not in it
- **THEN** the section is not shown

#### Scenario: Open the leftover workspace
- **WHEN** the user presses "Open workspace" in the section
- **THEN** Orca shows that workspace

### Requirement: Forget a link
Each entry in the section SHALL offer "Forget", which removes the item's link to the workspace without changing the workspace. The entry SHALL then leave the section. The removal SHALL hold across panels and worker restarts.

#### Scenario: Forget a leftover link
- **WHEN** the user presses "Forget" on `DIOGEN-449` in the section
- **THEN** the entry disappears, and the workspace still exists in Orca

#### Scenario: Forgotten item comes back
- **WHEN** a forgotten item is assigned to the user again and is open
- **THEN** it is listed with Start, not "Open workspace"
