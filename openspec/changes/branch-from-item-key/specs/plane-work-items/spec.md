## ADDED Requirements

### Requirement: Start names the branch after the item
A workspace created by Start SHALL be on a new Git branch named exactly like the workspace, `<KEY-N>-<title slug>`, with no prefix added. The Start confirmation SHALL show the branch name. Other workspaces SHALL keep the branch Orca gives them. A worktree created by hand with the same name in the same project while that Start is pending is also given that branch; Orca does not fail either create but gives the second one `<name>-2` for its path and branch (observed in Orca 1.4.262, issue #16 gate comment). So the Start's branch is exact unless a same-named worktree is made by hand in those seconds. An existing branch with that name and no worktree is reused as it is, its old commits included.

#### Scenario: Branch of a started workspace
- **WHEN** the user starts `DIOGEN-449` "Fix login timeout" and confirms
- **THEN** the new workspace's branch is `DIOGEN-449-fix-login-timeout`

#### Scenario: Confirmation shows the branch
- **WHEN** the Start confirmation is open for `DIOGEN-449` "Fix login timeout"
- **THEN** it shows the branch `DIOGEN-449-fix-login-timeout`

#### Scenario: Other workspaces are untouched
- **WHEN** the user creates a workspace in Orca without the plugin, with a name no pending Start uses
- **THEN** its branch is the one Orca chooses

#### Scenario: Same name by hand after the Start's create
- **WHEN** the Start of `DIOGEN-449` is pending and its create reached Orca first, and the user creates by hand a worktree named `DIOGEN-449-fix-login-timeout` in the same project
- **THEN** both creates succeed: the Start's workspace is on branch `DIOGEN-449-fix-login-timeout`, and the manual one gets path and branch `DIOGEN-449-fix-login-timeout-2`

#### Scenario: Same name by hand before the Start's create
- **WHEN** the user creates by hand a worktree named `DIOGEN-449-fix-login-timeout` in the same project and it reaches Orca first, while the Start of `DIOGEN-449` is pending
- **THEN** both creates succeed: the manual one is on branch `DIOGEN-449-fix-login-timeout`, and the Start's workspace gets path and branch `DIOGEN-449-fix-login-timeout-2`

#### Scenario: Branch exists without a worktree
- **WHEN** the repository already has a branch `DIOGEN-449-fix-login-timeout` that no worktree uses, and the user starts `DIOGEN-449` "Fix login timeout"
- **THEN** the new workspace reuses that branch as it is, its old commits included

### Requirement: Start prompt asks for the key in the PR title
The default Start prompt SHALL ask the agent to put the item key in the title of any pull request it opens for the item, outside the fenced ticket block.

#### Scenario: Key in the PR title
- **WHEN** the user opens the Start confirmation for `DIOGEN-449`
- **THEN** the prompt asks, outside the ticket block, that a pull request title contain `DIOGEN-449`
