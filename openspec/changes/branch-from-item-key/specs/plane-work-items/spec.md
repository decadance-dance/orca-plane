## ADDED Requirements

### Requirement: Start names the branch after the item
A workspace created by Start SHALL be on a new Git branch named exactly like the workspace, `<KEY-N>-<title slug>`, with no prefix added. The Start confirmation SHALL show the branch name. Workspaces that the plugin did not start SHALL keep the branch Orca gives them.

#### Scenario: Branch of a started workspace
- **WHEN** the user starts `DIOGEN-449` "Fix login timeout" and confirms
- **THEN** the new workspace's branch is `DIOGEN-449-fix-login-timeout`

#### Scenario: Confirmation shows the branch
- **WHEN** the Start confirmation is open for `DIOGEN-449` "Fix login timeout"
- **THEN** it shows the branch `DIOGEN-449-fix-login-timeout`

#### Scenario: Other workspaces are untouched
- **WHEN** the user creates a workspace in Orca without the plugin
- **THEN** its branch is the one Orca chooses

### Requirement: Start prompt asks for the key in the PR title
The default Start prompt SHALL ask the agent to put the item key in the title of any pull request it opens for the item, outside the fenced ticket block.

#### Scenario: Key in the PR title
- **WHEN** the user opens the Start confirmation for `DIOGEN-449`
- **THEN** the prompt asks, outside the ticket block, that a pull request title contain `DIOGEN-449`
