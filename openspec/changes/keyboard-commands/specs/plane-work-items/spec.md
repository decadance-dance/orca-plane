## ADDED Requirements

### Requirement: Open an item by key or URL
The list SHALL offer a field that takes an item key (`KEY-N`, any case) or a Plane URL of an item in the connected workspace, and opens that item's detail on Enter, whether or not the item is in my list. A URL of another server, app path or workspace, text that is neither, and a key that Plane does not find SHALL each show a message saying so, and no request SHALL be sent for the first two.

#### Scenario: Key of an item assigned to someone else
- **WHEN** the user types `diogen-12` into the field and presses Enter, and that item exists but is assigned to someone else
- **THEN** the detail of `DIOGEN-12` opens

#### Scenario: Pasted URL
- **WHEN** the user pastes `https://app.plane.so/acme/browse/DIOGEN-12/` while connected to the workspace `acme` on Plane Cloud
- **THEN** the detail of `DIOGEN-12` opens

#### Scenario: Self-hosted Plane under a path
- **WHEN** the plugin is connected to a self-hosted Plane whose app is at `https://plane.example.org/tools/plane`, and the user pastes the URL that "Open in Plane" gives for `DIOGEN-12`
- **THEN** the detail of `DIOGEN-12` opens

#### Scenario: URL of another workspace
- **WHEN** the user pastes a Plane URL of the workspace `other` while connected to `acme`
- **THEN** the panel says the URL is not from the connected workspace, and no request is sent

#### Scenario: Unknown key
- **WHEN** Plane does not find the typed key
- **THEN** the panel says that no item has that key

### Requirement: Start a looked-up item
An item opened by key or URL whose state group is backlog, unstarted or started SHALL offer Start like a listed item, with the same confirmation and the same duplicate protection. Before it creates anything for an item that is not in my list, the plugin SHALL read the item from Plane again, under the current connection, and refuse when it is not open. An item that is in my list SHALL be started from the list as today, until the next refresh. An item in another state group SHALL NOT offer Start.

#### Scenario: Start an item from another person's list
- **WHEN** the user opens the open item `DIOGEN-12` by key and presses Start
- **THEN** the Start confirmation opens, and confirming creates its workspace as for a listed item

#### Scenario: Closed item
- **WHEN** the user opens a completed item by key
- **THEN** its detail shows no Start

#### Scenario: Closed between lookup and Start
- **WHEN** the user opens the open item `DIOGEN-12`, which is not in my list, by key; it is completed in Plane; and the user then confirms Start
- **THEN** Start is refused with a message that the item is not open, and no workspace is created

#### Scenario: Listed item closed before the next refresh
- **WHEN** `DIOGEN-449` is in my list, the user opens it by key, it is completed in Plane, and the user confirms Start before the list refreshes
- **THEN** Start proceeds from the list row, as for any listed item

#### Scenario: Account switched after a lookup
- **WHEN** the user looks up an item, disconnects, connects as another Plane user and confirms a Start of that key
- **THEN** the item is read again as the new user, and Start proceeds only if that user can read it and it is open

### Requirement: Go to a waiting agent from the keyboard
The plugin SHALL contribute the palette command "Plane: go to an agent that waits for you", with a default shortcut. It SHALL open the linked workspace whose agent has needed input for the longest time, counting from when it began to wait. When no linked agent needs input, it SHALL say so and open nothing.

#### Scenario: Two agents wait
- **WHEN** the agents of `DIOGEN-449` and `DIOGEN-450` need input, and `DIOGEN-450` began to wait earlier
- **THEN** the command opens the workspace of `DIOGEN-450`

#### Scenario: A waiting agent reports again
- **WHEN** `DIOGEN-450` began to wait first, and its agent reports waiting again later
- **THEN** the command still opens the workspace of `DIOGEN-450` first

#### Scenario: Nobody waits
- **WHEN** no linked agent needs input
- **THEN** the command reports that no agent waits, and the focused workspace stays

### Requirement: Open the shown item's workspace from the keyboard
The plugin SHALL contribute the palette command "Plane: open the workspace of the item shown in the panel". It SHALL open the linked workspace of the item whose detail the panel shows. When the panel shows no item, or the item has no linked workspace, it SHALL say so and open nothing.

#### Scenario: Shown item has a workspace
- **WHEN** the panel shows the detail of `DIOGEN-449`, which has a linked workspace, and the user runs the command
- **THEN** Orca shows that workspace

#### Scenario: Shown item has no workspace
- **WHEN** the panel shows an item without a linked workspace
- **THEN** the command reports that the item has no workspace

### Requirement: Palette commands for the list and the sidebar
The plugin SHALL contribute the palette command "Plane: refresh my work items", which starts a refresh of the list as the panel's refresh does, and SHALL give the existing "Plane: toggle the right sidebar" command a default shortcut.

#### Scenario: Refresh by command
- **WHEN** the user runs "Plane: refresh my work items" while connected
- **THEN** the list and the status bar count refresh from Plane

#### Scenario: Sidebar shortcut
- **WHEN** the user presses the default shortcut of "Plane: toggle the right sidebar"
- **THEN** Orca's right sidebar toggles
