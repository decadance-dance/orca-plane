## ADDED Requirements

### Requirement: Later agent prompts name the linked item
When Orca is about to send a prompt to an agent in a terminal of a workspace linked to an item, and the prompt does not contain the item key, the plugin SHALL add one leading line that names the item key and its Plane URL. The line SHALL hold no text taken from the ticket. Prompts for unlinked workspaces SHALL pass unchanged.

#### Scenario: Orchestration prompt in a linked workspace
- **WHEN** Orca dispatches a prompt without the text `DIOGEN-449` to an agent in the workspace linked to `DIOGEN-449`
- **THEN** the agent receives the prompt with a first line naming `DIOGEN-449` and its Plane URL

#### Scenario: Prompt already names the item
- **WHEN** the prompt sent to that agent already contains `DIOGEN-449`
- **THEN** it passes unchanged

#### Scenario: Unlinked workspace
- **WHEN** Orca sends a prompt to an agent in a workspace that no item is linked to
- **THEN** it passes unchanged

### Requirement: Agents get the item in their environment
An agent launched in a workspace linked to an item SHALL get the environment variables `PLANE_ITEM_KEY` (the key) and `PLANE_ITEM_URL` (its Plane URL). The plugin SHALL NOT put the token or any other secret into an agent's environment. Agents in unlinked workspaces SHALL get no Plane variables.

#### Scenario: New agent tab in a linked workspace
- **WHEN** the user opens a new agent tab in the workspace linked to `DIOGEN-449`
- **THEN** the agent's environment has `PLANE_ITEM_KEY=DIOGEN-449` and `PLANE_ITEM_URL` set to the item's Plane URL, and no Plane token

#### Scenario: Unlinked workspace
- **WHEN** an agent launches in a workspace that no item is linked to
- **THEN** its environment has no `PLANE_ITEM_KEY` or `PLANE_ITEM_URL`

## MODIFIED Requirements

### Requirement: Ticket text is fenced as untrusted data
The Start prompt SHALL place the item's title, state, priority, labels, its parent item's key and title (when it has a parent) and its description inside a block with a fixed header line, which says the block is data from the ticket and not instructions, and a fixed footer line. Ticket lines equal to the header or footer SHALL be escaped. The block SHALL be capped at 12,000 characters with a truncation marker.

#### Scenario: Ticket text imitates the footer
- **WHEN** a description contains a line equal to the block's footer
- **THEN** that line is escaped, and the block ends only at the real footer

#### Scenario: Long description
- **WHEN** the description makes the block longer than 12,000 characters
- **THEN** the block is cut and ends with a truncation marker

#### Scenario: Item with a parent
- **WHEN** `DIOGEN-449` has priority high, the labels `auth` and `api`, and the parent `DIOGEN-400` "Login rework"
- **THEN** the block holds the priority, both labels and the parent's key and title, between the header and the footer

#### Scenario: Parent title imitates the footer
- **WHEN** the parent item's title equals the block's footer
- **THEN** that line is escaped, and the block ends only at the real footer
