## RENAMED Requirements

- FROM: `### Requirement: Group a tab by state`
- TO: `### Requirement: Group a project's items by state`

## REMOVED Requirements

### Requirement: One tab per Plane project
**Reason**: The tabs wrapped into several lines once there were a few projects (#66); a project switcher replaces them.
**Migration**: "Switch between Plane projects" keeps the rules (names, order, counts, no all-projects entry, remembered selection, fallback to the first) with one picker; the remembered selection carries over.

## MODIFIED Requirements

### Requirement: List my open work items
The plugin SHALL list the work items of the connected workspace that are assigned to the connected user and in state group backlog, unstarted or started.

#### Scenario: Items across projects
- **WHEN** open items assigned to me exist in several projects
- **THEN** each project can be picked in the project switcher, and every item is listed under its project, in its state's group, on one line with its priority, key and title

#### Scenario: Closed or unassigned items
- **WHEN** an item is completed, cancelled, or not assigned to me
- **THEN** it is not listed

#### Scenario: Item with unknown state
- **WHEN** an item's state details are missing from the server's answer
- **THEN** the item is still listed, with its state shown as unknown

### Requirement: Group a project's items by state
Within the selected project, the list SHALL be grouped by state (its name in Plane), newest update first within a state. States SHALL be ordered by their Plane group (started, unstarted, backlog), then by their number of items in the project, most first, then by name. Items whose state is unknown SHALL come last. Each group SHALL show a header with the state's name and its item count. Groups SHALL NOT collapse.

#### Scenario: States of one group
- **WHEN** a project has 3 items In Progress, 2 Blocked and 1 In Review, all in group started, and 4 items in Todo, in group unstarted
- **THEN** the project shows the groups In Progress, Blocked, In Review and Todo, in that order, each headed by its name and count

### Requirement: Search the list
The panel SHALL offer a search field that filters the loaded list of every project by key, title or label, ignoring case, without a request to Plane. The field MAY sit behind a control that shows it; it SHALL stay shown while it holds text. Each project in the switcher SHALL show the number of its items that match. The completeness state and the status bar count SHALL always describe the whole list, not the filtered one.

#### Scenario: Search by label
- **WHEN** the user types a label's name into the search field
- **THEN** only the items whose key, title or a label contains that text are shown, still under their project and grouped by state, and each project in the switcher shows its count of matches

#### Scenario: Nothing matches
- **WHEN** no item in the selected project matches the search text
- **THEN** the panel says that no items match and offers to clear the search

#### Scenario: Remembered search
- **WHEN** the panel opens with a remembered search text
- **THEN** the search field is shown with that text

### Requirement: Filter by a tag
The panel SHALL offer a filter control that shows the priorities and labels present in the loaded list as tags that can be pressed. Pressing a tag SHALL add it to the active filter, which shows only the items that have every active tag, in every project and together with the search text. Pressing an active tag SHALL remove it. Active tags SHALL be drawn filled. The tags SHALL stay shown while a tag is active. The panel SHALL remember the active tags, and clearing the search SHALL clear them too. The completeness state and the status bar count SHALL describe the whole list.

#### Scenario: Filter by a label
- **WHEN** the user opens the filter and presses the label `dst`
- **THEN** only the items labelled `dst` are shown, each project in the switcher shows its count of them, and the `dst` tag is filled

#### Scenario: Two tags
- **WHEN** the labels `dst` and `deploy` are active
- **THEN** only the items that have both labels are shown

#### Scenario: Press an active tag again
- **WHEN** the user presses an active tag
- **THEN** it is no longer active, and the items it hid are shown again

#### Scenario: Remembered tag
- **WHEN** the panel opens with a remembered active tag
- **THEN** the tags are shown, with that tag filled

### Requirement: Item detail
Opening an item SHALL show, first, a header with its key, priority, title, state, assignees, labels and last update; right below it, its actions: Start (or Open workspace) and a control that opens the item in Plane's web app; then its description. The description SHALL keep its formatting: paragraphs, headings, lists, links, code and quotes. Each list row SHALL open its item when pressed, and the detail SHALL offer a way back to the list.

#### Scenario: Open an item
- **WHEN** the user opens an item from the list
- **THEN** its details, its actions and its formatted description are shown, in that order

#### Scenario: Open from the list and go back
- **WHEN** the user presses a list row, then the back control in the detail
- **THEN** the detail opens, then the list shows again

#### Scenario: Open in Plane
- **WHEN** the user presses "Open in Plane"
- **THEN** Plane's page for that item opens in the browser, at `<app origin>/<slug>/browse/<KEY-N>/`

### Requirement: Show the agent state of a linked item
For an item linked to an existing workspace, the list row and the item detail SHALL show the latest known state of the agent in that workspace, named as the agent's: "Agent working", "Agent needs input" (Orca's blocked or waiting) or "Agent done". When no state has been reported since the plugin started, nothing SHALL be shown. The row SHALL update when the state changes, without a refresh from Plane.

#### Scenario: Agent waits for input
- **WHEN** the agent in an item's linked workspace reports that it is waiting for input
- **THEN** the item's row shows "Agent needs input"

#### Scenario: Agent finishes
- **WHEN** the agent in an item's linked workspace reports done
- **THEN** the item's row and detail show "Agent done"

#### Scenario: Unlinked workspace
- **WHEN** an agent reports a state in a workspace that no item is linked to
- **THEN** no row changes

#### Scenario: No state known yet
- **WHEN** an item has a linked workspace and no agent state has been reported since the plugin started
- **THEN** its row shows no agent state

### Requirement: Show workspaces of items no longer open
When the list is complete, the panel SHALL show, below the list, a collapsible section listing each existing linked workspace whose item is not in the list and that the user has not hidden. Each entry SHALL show the item key, the workspace name when the plugin knows it, and "Open workspace". The section SHALL be hidden when it would be empty, and while the list is partial, stale or failed.

#### Scenario: Item finished in Plane
- **WHEN** the item `DIOGEN-449` with a linked workspace is moved to Done in Plane and the complete list is refreshed
- **THEN** `DIOGEN-449` leaves its project's list, and the section lists `DIOGEN-449` with its workspace name and "Open workspace"

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

## ADDED Requirements

### Requirement: Switch between Plane projects
The list SHALL show one Plane project at a time, picked in one project switcher. The switcher SHALL offer each Plane project that has listed items, named by the key prefix of its newest item (`DIOGEN` for `DIOGEN-449`), ordered alphabetically, each with its count of matching items (`DIOGEN · 3`). There SHALL be no entry for all projects. The panel SHALL remember the selected project; when it has no listed items anymore, the first project SHALL be selected.

#### Scenario: Selected project is remembered
- **WHEN** the user selects the project `ENGAUTUMNS` and the panel is opened again
- **THEN** the project `ENGAUTUMNS` is selected

#### Scenario: Selected project has no items anymore
- **WHEN** the remembered project has no listed items after a refresh
- **THEN** the first project is selected
