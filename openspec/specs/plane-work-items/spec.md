# plane-work-items Specification

## Purpose
Brings a developer's Plane work items into Orca. They can see their open items, read one, and start a coding agent on it in a new workspace, without copying ticket details by hand.

## Requirements

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
The plugin SHALL list the work items of the connected workspace that are assigned to the connected user and in state group backlog, unstarted or started.

#### Scenario: Items across projects
- **WHEN** open items assigned to me exist in several projects
- **THEN** each project has its own tab, and every item is listed in its project's tab with its key, title, state, priority, labels and last update

#### Scenario: Closed or unassigned items
- **WHEN** an item is completed, cancelled, or not assigned to me
- **THEN** it is not listed

#### Scenario: Item with unknown state
- **WHEN** an item's state details are missing from the server's answer
- **THEN** the item is still listed, with its state shown as unknown

### Requirement: One tab per Plane project
The list SHALL be split into one tab per Plane project that has listed items, named by the key prefix of its newest item (`DIOGEN` for `DIOGEN-449`) and ordered alphabetically. There SHALL be no tab for all projects. The panel SHALL remember the selected tab; when its project has no listed items anymore, the first tab SHALL be selected.

#### Scenario: Selected tab is remembered
- **WHEN** the user selects the tab `ENGAUTUMNS` and the panel is opened again
- **THEN** the tab `ENGAUTUMNS` is selected

#### Scenario: Selected project has no items anymore
- **WHEN** the remembered tab's project has no listed items after a refresh
- **THEN** the first tab is selected

### Requirement: Group a tab by state
Within a project's tab, the list SHALL be grouped by state (its name in Plane), newest update first within a state. States SHALL be ordered by their Plane group (started, unstarted, backlog), then by their number of items in the tab, most first, then by name. Items whose state is unknown SHALL come last. Each group SHALL show its item count and can be collapsed.

#### Scenario: States of one group
- **WHEN** a project has 3 items In Progress, 2 Blocked and 1 In Review, all in group started, and 4 items in Todo, in group unstarted
- **THEN** its tab shows the groups In Progress, Blocked, In Review and Todo, in that order

### Requirement: Search the list
The panel SHALL offer a search field that filters the loaded list of every project by key, title or label, ignoring case, without a request to Plane. Each tab label SHALL show the number of its items that match. The completeness state and the status bar count SHALL always describe the whole list, not the filtered one.

#### Scenario: Search by label
- **WHEN** the user types a label's name into the search field
- **THEN** only the items whose key, title or a label contains that text are shown, still in their project's tab and grouped by state, and each tab shows its count of matches

#### Scenario: Nothing matches
- **WHEN** no item in the selected tab matches the search text
- **THEN** the panel says that no items match and offers to clear the search

### Requirement: Filter by a tag
Each row's priority and labels SHALL be shown as tags that can be pressed. Pressing a tag SHALL add it to the active filter, which shows only the items that have every active tag, in every project and together with the search text. Pressing an active tag SHALL remove it. Active tags SHALL be drawn filled. The panel SHALL remember the active tags, and clearing the search SHALL clear them too. The completeness state and the status bar count SHALL describe the whole list.

#### Scenario: Filter by a label
- **WHEN** the user presses the label `dst` on a row
- **THEN** only the items labelled `dst` are shown, each tab shows its count of them, and every `dst` tag is filled

#### Scenario: Two tags
- **WHEN** the labels `dst` and `deploy` are active
- **THEN** only the items that have both labels are shown

#### Scenario: Press an active tag again
- **WHEN** the user presses an active tag
- **THEN** it is no longer active, and the items it hid are shown again

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
Start SHALL create an Orca workspace named `<KEY-N>-<title slug>` in the chosen Git project. It SHALL start the chosen agent there with a prompt that holds the item's key, title, state, URL and description. Start SHALL be offered on each list row and in the item detail. It SHALL first show a confirmation in which the user picks the project and the agent and can edit the prompt, and which shows the workspace name. Nothing SHALL be created until the user confirms.

#### Scenario: Start with an agent
- **WHEN** the user presses Start, picks a project and an agent in the confirmation and confirms
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

### Requirement: Start offers only installed agents
The agent choices in the Start confirmation SHALL be the known agents whose command is found on this computer, plus terminal only. When none is found or the check fails, every known agent SHALL be offered.

#### Scenario: Only installed agents are offered
- **WHEN** of the known agents' commands, only `claude` and `codex` are found on this computer
- **THEN** the agent choices are Claude Code, Codex and terminal only

#### Scenario: Nothing found
- **WHEN** no known agent's command is found, or the check fails
- **THEN** every known agent and terminal only are offered

### Requirement: Ticket text is fenced as untrusted data
The Start prompt SHALL place the item's title, state, priority, labels, its parent item (key and title when Plane gives them, the title alone otherwise; nothing when the item has no parent or the parent cannot be read) and its description inside a block with a fixed header line, which says the block is data from the ticket and not instructions, and a fixed footer line. Ticket lines equal to the header or footer SHALL be escaped. The block SHALL be capped at 12,000 characters with a truncation marker.

#### Scenario: Ticket text imitates the footer
- **WHEN** a description contains a line equal to the block's footer
- **THEN** that line is escaped, and the block ends only at the real footer

#### Scenario: Long description
- **WHEN** the description makes the block longer than 12,000 characters
- **THEN** the block is cut and ends with a truncation marker

#### Scenario: Item with a parent
- **WHEN** `DIOGEN-449` has priority high, the labels `auth` and `api`, and a parent titled "Login rework" whose project Plane does not report
- **THEN** the block holds the priority, both labels and the parent's title, between the header and the footer

#### Scenario: Parent title imitates the footer
- **WHEN** the parent item's title equals the block's footer
- **THEN** that line is escaped, and the block ends only at the real footer

#### Scenario: Parent cannot be read
- **WHEN** the item has a parent that Plane does not return
- **THEN** the block has no parent line, and Start works as without a parent

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

#### Scenario: Waiting workspace removed
- **WHEN** the only waiting agent's workspace is removed in Orca, with no further agent event
- **THEN** the status bar shows just the count, in its normal tone, and the item shows no agent state

#### Scenario: The waiting agent goes on
- **WHEN** the only waiting agent reports working again
- **THEN** the status bar shows just the count, in its normal tone

### Requirement: Collapse a long description
In the item detail, a description longer than about 500 characters or 10 lines SHALL first show collapsed: its first whole blocks within those limits, followed by a control that shows the whole description. When the first block alone exceeds the limits, the collapsed view SHALL show its start, cut at a word and ending with "…". The expanded description SHALL offer a control that collapses it again. A shorter description SHALL show in full, without the control. Each item SHALL open collapsed.

#### Scenario: Long description
- **WHEN** the user opens an item whose description has many paragraphs
- **THEN** the detail shows its first paragraphs and "Show more"; pressing it shows the whole description and "Show less"; pressing that collapses it again

#### Scenario: Short description
- **WHEN** the user opens an item whose description is within the limits
- **THEN** the whole description shows and there is no "Show more"

#### Scenario: Another item opens collapsed
- **WHEN** the user expands an item's description, goes back to the list and opens another item with a long description
- **THEN** that description shows collapsed

#### Scenario: Description that starts with a heading
- **WHEN** the user opens an item whose description starts with a heading followed by a paragraph longer than the limits
- **THEN** the detail shows the heading and the start of that paragraph, cut at a word and ending with "…", and "Show more"; a heading longer than half the character limit is left out, so the paragraph keeps room

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
When the focused Orca workspace changes to one that is linked to an item, the panel SHALL show that item's detail, also when the item is no longer in my list. An open Start confirmation SHALL stay open. Focusing an unlinked workspace, an event that leaves the same workspace focused, and the focus Orca reports when the plugin starts SHALL leave the panel as it is. The workspace SHALL be matched by its id, never by its branch or name.

#### Scenario: Switch to a linked workspace
- **WHEN** the user focuses the workspace that was started from `DIOGEN-449`
- **THEN** the panel shows the detail of `DIOGEN-449`

#### Scenario: Switch to an unlinked workspace
- **WHEN** the user focuses a workspace that no item is linked to
- **THEN** the panel keeps showing what it showed

#### Scenario: Linked item that left the list
- **WHEN** `DIOGEN-449` was moved to Done in Plane and the user focuses its linked workspace
- **THEN** the panel shows the detail of `DIOGEN-449`

#### Scenario: Same branch in another repository
- **WHEN** the workspace linked to `DIOGEN-449` is on branch `main`, and the user focuses another repository's unlinked workspace that is also on `main`
- **THEN** the panel keeps showing what it showed

#### Scenario: Back in the list
- **WHEN** the panel follows to an item, and the user goes back to the list while the same workspace stays focused
- **THEN** the panel stays on the list until another linked workspace is focused

### Requirement: Readiness hints before Start
The Start confirmation SHALL show readiness hints. An item without a description SHALL get exactly one hint, that it has no description. Otherwise it SHALL get one hint for each of these that holds: the description has fewer than 200 characters of text; it has no checklist item; it has no code reference (inline code, a code block or a file path) and no link. Hints SHALL NOT disable Start and SHALL NOT need a request to Plane or to a model.

#### Scenario: Empty description
- **WHEN** the user opens the Start confirmation for an item without a description
- **THEN** the confirmation shows exactly one hint, that the item has no description, and Confirm stays enabled

#### Scenario: Short description without criteria
- **WHEN** the item's description is the single sentence "Login is slow."
- **THEN** the confirmation shows exactly three hints: a short description, no checklist, and no code reference or link

#### Scenario: Ready ticket
- **WHEN** the description is longer than 200 characters, has a checklist item and names the file `src/auth/login.ts`
- **THEN** the confirmation shows no hints

### Requirement: Start names the branch after the item
Start SHALL ask Orca for a Git branch named exactly like the workspace, `<KEY-N>-<title slug>`, with no prefix. The Start confirmation SHALL show that branch, and Start SHALL create the workspace under the name it shows. Other workspaces SHALL keep Orca's branch. Orca decides two cases, stated in their scenarios as observed in Orca 1.4.262 (gate on #16): a same-named manual worktree while the Start is pending, and an existing branch of that name.

#### Scenario: Branch of a started workspace
- **WHEN** the user starts `DIOGEN-449` "Fix login timeout" and confirms, and no branch or worktree of that name exists
- **THEN** the new workspace's branch is `DIOGEN-449-fix-login-timeout`

#### Scenario: Confirmation shows the branch
- **WHEN** the Start confirmation is open for `DIOGEN-449` "Fix login timeout", while the cached list still has an older title
- **THEN** it shows the branch `DIOGEN-449-fix-login-timeout`, and Confirm creates the workspace `DIOGEN-449-fix-login-timeout` on that branch

#### Scenario: Other workspaces are untouched
- **WHEN** the user creates a workspace in Orca without the plugin, with a name no pending Start uses
- **THEN** its branch is the one Orca chooses

#### Scenario: Same name by hand after the Start's create
- **WHEN** the Start of `DIOGEN-449` is pending and its create reached Orca first, and the user creates by hand a worktree named `DIOGEN-449-fix-login-timeout` in the same project
- **THEN** both creates succeed: the Start's workspace is on branch `DIOGEN-449-fix-login-timeout`, and the manual one gets path and branch `DIOGEN-449-fix-login-timeout-2`

#### Scenario: Same name by hand before the Start's create
- **WHEN** no branch named `DIOGEN-449-fix-login-timeout` exists, the Start of `DIOGEN-449` is pending, and the user creates by hand a worktree named `DIOGEN-449-fix-login-timeout` in the same project that reaches Orca first
- **THEN** the hook gives both creates that branch, both succeed: the manual one is on branch `DIOGEN-449-fix-login-timeout`, and the Start's workspace gets path and branch `DIOGEN-449-fix-login-timeout-2`

#### Scenario: Branch exists without a worktree
- **WHEN** the repository already has a branch `DIOGEN-449-fix-login-timeout` that no worktree uses, and the user starts `DIOGEN-449` "Fix login timeout"
- **THEN** the new workspace reuses that branch as it is, its old commits included

### Requirement: Start prompt asks for the key in the PR title
The default Start prompt SHALL ask the agent to put the item key in the title of any pull request it opens for the item, outside the fenced ticket block.

#### Scenario: Key in the PR title
- **WHEN** the user opens the Start confirmation for `DIOGEN-449`
- **THEN** the prompt asks, outside the ticket block, that a pull request title contain `DIOGEN-449`

### Requirement: Item detail shows earlier Starts
The item detail SHALL list the item's earlier Starts, newest first, each with its time, agent (or terminal only), Orca project, workspace name and outcome: created, failed or not confirmed. At most the last 10 Starts per item SHALL be shown. An item that was never started SHALL show no such list.

#### Scenario: Started before, workspace removed
- **WHEN** the user started `DIOGEN-449` with Claude Code three days ago, removed its workspace, and opens the item
- **THEN** the detail lists that Start with its time, "Claude Code", the project, the workspace name and "created", and offers Start

#### Scenario: Failed Start
- **WHEN** a Start of the item failed
- **THEN** that entry shows "failed"

#### Scenario: Never started
- **WHEN** the user opens an item that was never started
- **THEN** the detail shows no list of earlier Starts

### Requirement: Start history is kept per connection
The Start history SHALL survive worker restarts and the removal of workspaces. It SHALL be deleted when the user disconnects, like the connection's other data, and SHALL be capped at 10 entries per item and 50 items, dropping the oldest, and SHALL stay within Orca's storage limit for one value by dropping the oldest items.

#### Scenario: Worker restart
- **WHEN** Orca restarts the plugin's worker
- **THEN** the item's earlier Starts are still listed

#### Scenario: Worker stops during a Start
- **WHEN** the worker stops after a Start was accepted and before Orca answered, and Orca did create the workspace
- **THEN** after the restart the item's history lists that Start, and once the plugin finds the workspace its outcome is "created"

#### Scenario: Disconnect
- **WHEN** the user disconnects and connects again
- **THEN** no earlier Starts are listed

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

### Requirement: Later agent prompts name the linked item
When Orca submits a prompt to an agent through its `agent.prompt.before` hook (an orchestration dispatch, `orca terminal send` to an agent) in a terminal that the plugin knows belongs to a workspace linked to an item, and the prompt does not contain the item key, the plugin SHALL add one leading line that names the item key and its Plane URL. The line SHALL hold no text taken from the ticket. Prompts to other terminals SHALL pass unchanged.

#### Scenario: Orchestration prompt in a linked workspace
- **WHEN** Orca dispatches a prompt without the text `DIOGEN-449` to an agent in a terminal of the workspace linked to `DIOGEN-449`, and that terminal existed when the link became known or was reported to the plugin since
- **THEN** the agent receives the prompt with a first line naming `DIOGEN-449` and its Plane URL

#### Scenario: Prompt already names the item
- **WHEN** the prompt sent to that agent already contains `DIOGEN-449`
- **THEN** it passes unchanged

#### Scenario: Unlinked workspace
- **WHEN** Orca sends a prompt to an agent in a workspace that no item is linked to
- **THEN** it passes unchanged

#### Scenario: Terminal the plugin has not seen
- **WHEN** Orca sends a prompt to a terminal that Orca has never reported to the plugin
- **THEN** it passes unchanged

#### Scenario: Prompt that does not pass the hook
- **WHEN** a prompt reaches the agent without `agent.prompt.before`, such as the one given to `orca agent launch --prompt` in Orca 1.4.262
- **THEN** it has no item line, and the agent still gets the item in its environment

### Requirement: Agents get the item in their environment
An agent launched in a workspace that is linked to an item when the launch starts SHALL get the environment variables `PLANE_ITEM_KEY` (the key) and `PLANE_ITEM_URL` (its Plane URL). The plugin SHALL NOT put the token or any other secret into an agent's environment. Agents in unlinked workspaces SHALL get no Plane variables. The first agent of a Start gets them only when Orca launches it after `workspace.create` has returned; its prompt names the item either way.

#### Scenario: New agent tab in a linked workspace
- **WHEN** the user opens a new agent tab in the workspace linked to `DIOGEN-449`
- **THEN** the agent's environment has `PLANE_ITEM_KEY=DIOGEN-449` and `PLANE_ITEM_URL` set to the item's Plane URL, and no Plane token

#### Scenario: Unlinked workspace
- **WHEN** an agent launches in a workspace that no item is linked to
- **THEN** its environment has no `PLANE_ITEM_KEY` or `PLANE_ITEM_URL`

#### Scenario: First agent launched before the create returns
- **WHEN** Orca launches the Start's agent before `workspace.create` has returned the workspace id
- **THEN** the agent has no Plane variables, and its prompt names `DIOGEN-449` and its URL

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

### Requirement: Start prompt follows the user's template
The plugin SHALL offer a multi-line setting for a Start prompt template with the placeholders `{key}`, `{url}` and `{ticket}`. A non-empty template SHALL replace the default instructions of the Start prompt, and its first `{ticket}` SHALL become the fenced ticket block. An empty template SHALL give the default prompt. The prompt SHALL stay editable in the confirmation.

#### Scenario: Template with all placeholders
- **WHEN** the template is "Read AGENTS.md first. Item {key} ({url}).\n{ticket}\nOpen a PR titled with {key}." and the user starts `DIOGEN-449`
- **THEN** the confirmation's prompt is that text with the key, the item's URL and the fenced ticket block in place of the placeholders

#### Scenario: Empty template
- **WHEN** the template setting is empty
- **THEN** the confirmation's prompt is the default prompt

### Requirement: A template cannot drop or break the ticket block
Whatever the template says, the Start prompt SHALL contain the fenced ticket block exactly once, with its header and footer each on a whole line, and the item key and URL. Only the first `{ticket}` SHALL become the block; with none, the block SHALL be appended. When `{key}` or `{url}` is missing, a first line SHALL name both. Placeholders SHALL be replaced in one pass.

#### Scenario: Template without the ticket placeholder
- **WHEN** the template is "Follow AGENTS.md." with no placeholders
- **THEN** the prompt starts with a line naming the key and URL, then "Follow AGENTS.md.", and ends with the fenced ticket block

#### Scenario: Two ticket placeholders
- **WHEN** the template is "{ticket}\n{ticket}"
- **THEN** the prompt contains the block once

#### Scenario: Placeholder inside a sentence
- **WHEN** the template is "Read {ticket} before coding."
- **THEN** the block's header and footer each stand on a line of their own, with "Read" before the block and "before coding." after it

#### Scenario: Template imitates the footer
- **WHEN** the template contains a line equal to the block's footer
- **THEN** that line is escaped, and the prompt has exactly one unescaped header line and one unescaped footer line, both from the real block

#### Scenario: Ticket text holds a placeholder
- **WHEN** the item's description contains the text `{ticket}`
- **THEN** that text appears unchanged inside the block, and the block appears once
