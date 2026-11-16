# Spec Delta

## Purpose

Brings a developer's Plane work items into Orca. They can see their open items, read one, and start a coding agent on it in a new workspace, without copying ticket details by hand.

## ADDED Requirements

### Requirement: Connect to a Plane workspace
The plugin SHALL connect to one Plane workspace, given a server (Plane Cloud by default, or a self-hosted URL), a workspace slug and a personal access token. It SHALL validate them against the server before it saves anything.

#### Scenario: Successful connect
- **WHEN** the user submits a valid server, slug and token
- **THEN** the plugin shows the connected user and workspace, and loads the list of open items

#### Scenario: Invalid token
- **WHEN** the server answers the validation request with 401
- **THEN** the plugin saves nothing and shows that the token is invalid

#### Scenario: Unknown workspace
- **WHEN** the server answers the list request for the slug with 404
- **THEN** the plugin saves nothing and shows that the workspace was not found

#### Scenario: Server without API v2
- **WHEN** the server does not serve Plane API v2, either returning HTML or a route-not-found 404 for the v2 path
- **THEN** the plugin saves nothing and shows that the server is not supported

### Requirement: Refuse unsafe server addresses
The plugin SHALL refuse a server URL that uses plain `http` on a host other than a loopback address, or that carries a username or password. It SHALL send no request to a refused URL.

#### Scenario: Plain http to a remote host
- **WHEN** the user enters `http://plane.example.com`
- **THEN** the connect is refused before any request is sent

#### Scenario: Loopback over http
- **WHEN** the user enters `http://localhost:8000`
- **THEN** the connect proceeds

### Requirement: Token stays bound to its connection
The plugin SHALL send the token only to the API origin it was saved with, in the `X-API-Key` header, with redirects refused. Switching server, workspace or account SHALL require a new connect.

#### Scenario: Request to another origin
- **WHEN** any request URL has an origin other than the connection's API origin
- **THEN** the request is refused before it is sent

#### Scenario: Server answers with a redirect
- **WHEN** the server answers an authenticated request with a redirect
- **THEN** the redirect is not followed and the request fails

#### Scenario: Reconnect to another server
- **WHEN** the user disconnects and connects to a different server with a new token
- **THEN** no request to the new server carries the old token

### Requirement: Token is never exposed
The token SHALL appear only in these places:
- the masked connect field, cleared after submit and never persisted;
- the connect request;
- the plugin's encrypted secret record;
- the `X-API-Key` header of requests to the bound origin.

It SHALL NOT appear in logs, plugin storage, settings, panel messages, request results or error messages.

#### Scenario: Errors and logs
- **WHEN** any request fails, or the plugin logs an event
- **THEN** the error text and the log lines do not contain the token

#### Scenario: Panel never receives the token
- **WHEN** the panel asks for the connection status
- **THEN** the answer contains the server, slug and user name, but not the token

### Requirement: Refuse to store a token without a protected key store
The plugin SHALL refuse to connect when Orca reports that secrets cannot be protected at rest. It SHALL NOT store the token anywhere else.

#### Scenario: No OS key store
- **WHEN** secret protection is reported as unavailable
- **THEN** the connect is refused with a message that a protected key store is required

### Requirement: Disconnect removes the connection and its data
Disconnecting SHALL delete the secret record and that connection's cached items and item-workspace links, and SHALL clear the status bar. Results of requests still in flight SHALL be discarded.

#### Scenario: Disconnect during a refresh
- **WHEN** the user disconnects while a refresh is running
- **THEN** the refresh result is discarded, and the panel and status bar show the disconnected state

#### Scenario: Switching account clears old items
- **WHEN** the user connects as a different Plane user
- **THEN** none of the previous user's items or links are shown

### Requirement: List my open work items
The plugin SHALL list the work items of the connected workspace that are assigned to the connected user and in state group backlog, unstarted or started. The list SHALL be grouped by state group and, within a group, newest update first. Each group SHALL show its item count and can be collapsed.

#### Scenario: Items across projects
- **WHEN** open items assigned to me exist in several projects
- **THEN** all of them are listed, each with its key, title, state, priority, labels and last update

#### Scenario: Closed or unassigned items
- **WHEN** an item is completed, cancelled, or not assigned to me
- **THEN** it is not listed

#### Scenario: Item with unknown state
- **WHEN** an item's state details are missing from the server's answer
- **THEN** the item is still listed, with its state shown as unknown

### Requirement: Search the list
The panel SHALL offer a search field that filters the loaded list by key, title or label, ignoring case, without a request to Plane. The completeness state and the status bar count SHALL always describe the whole list, not the filtered one.

#### Scenario: Search by label
- **WHEN** the user types a label's name into the search field
- **THEN** only the items whose key, title or a label contains that text are shown, still grouped by state group

#### Scenario: Nothing matches
- **WHEN** no loaded item matches the search text
- **THEN** the panel says that no items match and offers to clear the search

### Requirement: Show whether the list is complete
The list SHALL always carry one of these completeness states:
- `complete`;
- `partial`: the item cap was reached, or a page failed;
- `stale`: the last refresh failed and older data is shown;
- `error`: no data.

Partial or stale data SHALL never be shown as complete.

#### Scenario: More items than the cap
- **WHEN** the server reports more items after the plugin's item cap is reached
- **THEN** the list is marked partial

#### Scenario: A later page fails
- **WHEN** the first page loads and a later page fails
- **THEN** the loaded items are shown and the list is marked partial, with the error

#### Scenario: Refresh fails after a good one
- **WHEN** a refresh fails after an earlier refresh succeeded
- **THEN** the earlier items are shown and the list is marked stale, with the error

### Requirement: The list answers without waiting for the network
Opening or reloading the panel SHALL show the last known list at once and refresh it in the background when it is older than one minute or a refresh is asked for. A refresh SHALL finish even if the panel is closed.

#### Scenario: Slow server
- **WHEN** the server takes longer than the panel's request timeout to answer a refresh
- **THEN** the panel shows the last known list at once and updates when the refresh ends

#### Scenario: Two refresh triggers
- **WHEN** a refresh is requested while one is running
- **THEN** no second refresh starts, and both requests get the running refresh's result

### Requirement: Respect the server's rate limit
On a 429 answer to a read, the plugin SHALL retry at most once, and only when the server's indicated wait is 30 seconds or less. Otherwise it SHALL report the rate limit with the time it ends.

#### Scenario: Short rate-limit wait
- **WHEN** a list request gets 429 with a wait of 5 seconds
- **THEN** the plugin retries once after that wait

#### Scenario: Long rate-limit wait
- **WHEN** a list request gets 429 with a wait of 60 seconds
- **THEN** the plugin does not retry, and shows that it is rate limited until then

### Requirement: Item detail
Opening an item SHALL show its key, title, state, priority, assignees, labels, last update and description, plus a control that opens the item in Plane's web app. The description SHALL keep its formatting: paragraphs, headings, lists, links, code and quotes. Each list row SHALL offer Open, and the detail SHALL offer a way back to the list.

#### Scenario: Open an item
- **WHEN** the user opens an item from the list
- **THEN** its details and formatted description are shown

#### Scenario: Open from the list and go back
- **WHEN** the user presses Open on a list row, then the back control in the detail
- **THEN** the detail opens, then the list shows again

#### Scenario: Open in Plane
- **WHEN** the user presses "Open in Plane"
- **THEN** Plane's page for that item opens in the browser, at `<app origin>/<slug>/browse/<KEY-N>/`

### Requirement: Start an agent workspace for an item
Start SHALL create an Orca workspace named `<KEY-N>-<title slug>` in the chosen Git project. It SHALL start the chosen agent there with a prompt that holds the item's key, title, state, URL and description. Start SHALL be offered on each list row and in the item detail. It SHALL first show a confirmation with the workspace name, project, agent and the prompt, which the user can edit. Nothing SHALL be created until the user confirms.

#### Scenario: Start with an agent
- **WHEN** the user picks a project and an agent, presses Start and confirms
- **THEN** a workspace with that name is created and the agent starts with the prompt

#### Scenario: Start from the list, then cancel
- **WHEN** the user presses Start on a list row and then cancels the confirmation
- **THEN** no workspace is created and the item can be started again

#### Scenario: Start without an agent
- **WHEN** the user picks "terminal only"
- **THEN** the workspace is created and no agent starts

#### Scenario: Only Git projects are offered
- **WHEN** the user picks the project for Start
- **THEN** only Orca Git projects are offered, and folder projects are not

### Requirement: Ticket text is fenced as untrusted data
The Start prompt SHALL place the item's title and description inside a block with a fixed header line, which says the block is data from the ticket and not instructions, and a fixed footer line. Ticket lines equal to the header or footer SHALL be escaped. The block SHALL be capped at 12,000 characters with a truncation marker.

#### Scenario: Ticket text imitates the footer
- **WHEN** a description contains a line equal to the block's footer
- **THEN** that line is escaped, and the block ends only at the real footer

#### Scenario: Long description
- **WHEN** the description makes the block longer than 12,000 characters
- **THEN** the block is cut and ends with a truncation marker

### Requirement: Start does not create duplicate workspaces
Start SHALL be refused for an item while a Start for it is pending, or while its outcome is unknown and not yet reconciled. This holds across panels and worker restarts. An item with a linked, existing workspace SHALL offer "Open workspace" instead of Start.

#### Scenario: Double press
- **WHEN** Start is pressed twice for the same item, from one panel or from two
- **THEN** only one workspace is created

#### Scenario: Lost reply
- **WHEN** the outcome of a Start is unknown, after a lost reply or a worker restart
- **THEN** the plugin looks for a workspace with the recorded name in that project. If it finds one, it links it. If not, it offers Start again

#### Scenario: Agent fails after the workspace exists
- **WHEN** the workspace is created but the agent fails to start
- **THEN** the workspace is linked to the item, and the error is shown with "Open workspace"

#### Scenario: Linked workspace was deleted
- **WHEN** an item's linked workspace no longer exists in Orca
- **THEN** the item offers Start again

### Requirement: Status bar count
While connected, the status bar SHALL show the number of my open items when the list is complete, and `?` otherwise. It SHALL show nothing while disconnected. Pressing it SHALL toggle Orca's right sidebar, where the Plane panel lives. It SHALL refresh on the configured interval: at least 5 minutes, 10 by default.

#### Scenario: Complete list
- **WHEN** the list is complete with 12 items
- **THEN** the status bar shows 12

#### Scenario: Partial list
- **WHEN** the list is partial or stale
- **THEN** the status bar shows `?`

#### Scenario: Disconnected
- **WHEN** no connection exists
- **THEN** the status bar shows nothing and no background refresh runs
