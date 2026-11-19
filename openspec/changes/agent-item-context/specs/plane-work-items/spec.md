## ADDED Requirements

### Requirement: Later agent prompts name the linked item
When Orca is about to send a prompt to an agent in a terminal that the plugin knows belongs to a workspace linked to an item, and the prompt does not contain the item key, the plugin SHALL add one leading line that names the item key and its Plane URL. The line SHALL hold no text taken from the ticket. Prompts to other terminals SHALL pass unchanged.

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

## MODIFIED Requirements

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
