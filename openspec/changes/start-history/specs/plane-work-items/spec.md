## ADDED Requirements

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
The Start history SHALL survive worker restarts and the removal of workspaces. It SHALL be deleted when the user disconnects, like the connection's other data, and SHALL be capped at 10 entries per item and 500 items, dropping the oldest.

#### Scenario: Worker restart
- **WHEN** Orca restarts the plugin's worker
- **THEN** the item's earlier Starts are still listed

#### Scenario: Worker stops during a Start
- **WHEN** the worker stops after a Start was accepted and before Orca answered, and Orca did create the workspace
- **THEN** after the restart the item's history lists that Start, and once the plugin finds the workspace its outcome is "created"

#### Scenario: Disconnect
- **WHEN** the user disconnects and connects again
- **THEN** no earlier Starts are listed
