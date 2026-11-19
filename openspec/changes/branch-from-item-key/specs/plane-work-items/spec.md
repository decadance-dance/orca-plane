## ADDED Requirements

### Requirement: Start names the branch after the item
A workspace created by Start SHALL be on a new Git branch named exactly like the workspace, `<KEY-N>-<title slug>`, with no prefix added. The Start confirmation SHALL show the branch name. Other workspaces SHALL keep the branch Orca gives them. A worktree created by hand with the same name in the same project while that Start is pending SHALL also be given that branch, so whichever of the two creates comes second fails with Orca's error.

#### Scenario: Branch of a started workspace
- **WHEN** the user starts `DIOGEN-449` "Fix login timeout" and confirms
- **THEN** the new workspace's branch is `DIOGEN-449-fix-login-timeout`

#### Scenario: Confirmation shows the branch
- **WHEN** the Start confirmation is open for `DIOGEN-449` "Fix login timeout"
- **THEN** it shows the branch `DIOGEN-449-fix-login-timeout`

#### Scenario: Other workspaces are untouched
- **WHEN** the user creates a workspace in Orca without the plugin, with a name no pending Start uses
- **THEN** its branch is the one Orca chooses

#### Scenario: Same name by hand while the Start is pending
- **WHEN** the user creates by hand a worktree named `DIOGEN-449-fix-login-timeout` in the same project while the Start of `DIOGEN-449` is pending
- **THEN** only one of the two creates succeeds, on branch `DIOGEN-449-fix-login-timeout`; the other fails with Orca's error and, when it is the Start, the item shows the failed Start as today

### Requirement: Start prompt asks for the key in the PR title
The default Start prompt SHALL ask the agent to put the item key in the title of any pull request it opens for the item, outside the fenced ticket block.

#### Scenario: Key in the PR title
- **WHEN** the user opens the Start confirmation for `DIOGEN-449`
- **THEN** the prompt asks, outside the ticket block, that a pull request title contain `DIOGEN-449`
