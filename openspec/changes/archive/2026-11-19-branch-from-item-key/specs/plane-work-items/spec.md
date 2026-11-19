## ADDED Requirements

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
