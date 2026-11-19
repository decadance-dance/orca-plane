## ADDED Requirements

### Requirement: Open an item by key or URL
The list SHALL offer a field that takes an item key (`KEY-N`, any case) or a Plane URL of an item in the connected workspace, and opens that item's detail on Enter, whether or not the item is in my list. A URL of another server or workspace, text that is neither, and a key that Plane does not find SHALL each show a message saying so, and no request SHALL be sent for the first two.

#### Scenario: Key of an item assigned to someone else
- **WHEN** the user types `diogen-12` into the field and presses Enter, and that item exists but is assigned to someone else
- **THEN** the detail of `DIOGEN-12` opens

#### Scenario: Pasted URL
- **WHEN** the user pastes `https://app.plane.so/acme/browse/DIOGEN-12/` while connected to the workspace `acme` on Plane Cloud
- **THEN** the detail of `DIOGEN-12` opens

#### Scenario: URL of another workspace
- **WHEN** the user pastes a Plane URL of the workspace `other` while connected to `acme`
- **THEN** the panel says the URL is not from the connected workspace, and no request is sent

#### Scenario: Unknown key
- **WHEN** Plane does not find the typed key
- **THEN** the panel says that no item has that key

### Requirement: Start a looked-up item
An item opened by key or URL whose state group is backlog, unstarted or started SHALL offer Start like a listed item, with the same confirmation and the same duplicate protection. An item in another state group SHALL NOT offer Start.

#### Scenario: Start an item from another person's list
- **WHEN** the user opens the open item `DIOGEN-12` by key and presses Start
- **THEN** the Start confirmation opens, and confirming creates its workspace as for a listed item

#### Scenario: Closed item
- **WHEN** the user opens a completed item by key
- **THEN** its detail shows no Start

### Requirement: Go to a waiting agent from the keyboard
The plugin SHALL contribute the palette command "Plane: go to an agent that waits for you", with a default shortcut. It SHALL open the linked workspace whose agent has needed input for the longest time. When no linked agent needs input, it SHALL say so and open nothing.

#### Scenario: Two agents wait
- **WHEN** the agents of `DIOGEN-449` and `DIOGEN-450` need input, and `DIOGEN-450` has waited longer
- **THEN** the command opens the workspace of `DIOGEN-450`

#### Scenario: Nobody waits
- **WHEN** no linked agent needs input
- **THEN** the command reports that no agent waits, and the focused workspace stays

### Requirement: Refresh from the command palette
The plugin SHALL contribute the palette command "Plane: refresh my work items", which starts a refresh of the list as the panel's refresh does.

#### Scenario: Refresh by command
- **WHEN** the user runs "Plane: refresh my work items" while connected
- **THEN** the list and the status bar count refresh from Plane
