# Git workflow: git-flow
Read when: starting a task, committing, opening or merging a PR, releasing, or fixing a release.
TL;DR: Two permanent branches (`main` = released, `develop` = next release) and three temporary ones (`feature/*`, `release-*`, `hotfix-*`). Every branch works on a GitHub issue of this repo, named by its number (`#12`). Every merge into a permanent branch is a GitHub pull request, merged with a merge commit after the `ci-ok` check is green. Agents commit only on temporary branches, may push them and open PRs while working on an issue, and merge, tag or release only when the maintainer asks.

Source: Vincent Driessen, "A successful Git branching model", https://nvie.com/posts/a-successful-git-branching-model/. Deviations: our `master` is named `main`, and merges happen through GitHub pull requests instead of local `git merge`.

## Branches at a glance
| Type | Branches off | Merges into (by PR) | Name |
| --- | --- | --- | --- |
| task | `develop` | `develop` | `feature/<n>-<slug>` |
| release | `develop` | `main` **and** `develop` | `release-<version>` |
| urgent fix | `main` | `main` **and** `develop` | `hotfix-<version>` |

`develop` is the default branch on GitHub, so `Closes #<n>` in a PR into `develop` closes the issue when it merges. Delete each temporary branch right after its last PR is merged. GitHub's "Automatically delete head branches" is off on purpose: a `release-*` or `hotfix-*` branch needs two PRs, into `main` and then into `develop`, and auto-delete would remove it after the first.

## Permanent branches
### Do
- Treat `main` as released code: every commit on it is a release with its own tag.
- Treat `develop` as "the next release not yet out". Finished issues land here.
- Keep both branches forever.

### Don't
- Don't commit to `main` by hand. Code reaches it only through a PR from `release-*` or `hotfix-*`.
- Don't commit work directly on `develop`. It arrives through a PR from a `feature/*` branch.
- Don't rebase, reset, or force-push `main` or `develop`. A GitHub ruleset (`protect-permanent`) blocks direct pushes, force pushes and deletion on both.
- Don't wait for an approving review: the ruleset requires a PR with 0 approvals, because a sole maintainer cannot approve their own PR. The green `ci-ok` check is the gate. The repository admin may bypass the ruleset only through a PR (to merge past a broken check), never by a direct push.

## Task branch (`feature/*`)
### Do
- One issue, one branch: `git checkout -b feature/<n>-<slug> develop`, where `<n>` is the issue number (`feature/12-panel-filters`). No issue yet? Even a small fix gets one first (`gh issue create`).
- Running several agent sessions at once? Give each issue its own git worktree, so sessions don't share a checkout, and leave the primary checkout to reading.
- Commit as often as useful inside the branch; small, unfinished commits are fine.
- Commit only the files of this issue: name paths in `git add` and `git commit -- <paths>`.
- A draft PR may go up early: `gh pr create --draft --base develop`.
- Before a ready PR: run `bin/check`, get the cross-model review ([below](#cross-model-review)), and check that the PR description says what changed, why, and how it was verified. A PR that only touches an issue it does not finish says `Refs #<n>`, not `Closes #<n>`.
- Finish with a PR into `develop`. Pass the title and body explicitly, not `--fill`.
  ```
  git push -u origin feature/<n>-<slug>
  gh pr create --base develop --title "<summary>" --body "Closes #<n>. <what and why; how verified>"
  ```
  Wait for `ci-ok` to go green (`gh pr checks <pr> --watch`): it runs `bin/check` with the Orca CLI from the `orca-server` Linux release (`.github/workflows/ci.yml`). The maintainer merges with `gh pr merge <pr> -R decadance-dance/orca-plane --merge --delete-branch`. With `-R`, gh deletes only the remote branch and leaves the local checkout alone; without it, gh tries to switch the task's worktree to `develop` to delete the local branch, and git refuses when another checkout already has `develop`. Then, from the primary checkout, run `git pull` and delete the issue's local branch and its worktree, if it had one.

### Don't
- Don't branch a task off `main` or off another feature branch, unless the user asks for stacked work.
- Don't mix unrelated changes in one branch, or sweep someone else's uncommitted files into your commit (no blind `git add -A` in a shared checkout).
- Don't merge with a red `ci-ok` or with open blocking review findings.
- Don't pass `--no-verify` to `git commit` or `git merge`.
- Don't delete a branch before its PR has merged.

## Cross-model review
A PR written by a coding agent merges only after a reviewer of the other model family has reviewed its head commit.

- When: after `ci-ok` is green and before `gh pr ready`, on the pushed branch (the PR is a draft).
- Who: the other model family in a fresh session. Codex reviews Claude's code, Claude reviews Codex's. A subagent of the authoring session does not count: it shares the author's model and framing.
- Input: the diff (`git diff origin/develop...HEAD`), the issue (`gh issue view <n>`), and this guide, not the author's summary. The reviewer runs `bin/check`, and loads the plugin in Orca when the change touches what the user sees.
- Output: a GitHub review in Comment mode on the PR (`gh pr review <pr> --comment --body-file <file>`). A finding is must-fix only with a failing test or a repro; the author fixes or answers each finding in the PR.
- Rounds: at most two. After the second, the maintainer decides.
- A push after the review is a new commit: the reviewer looks at the change again.

## Merge commits on every merge
### Do
- Merge every PR into `develop` or `main` with GitHub's "Create a merge commit" (`gh pr merge --merge`). It is the `--no-ff` of this repo: an issue's work shows as one block in history and can be reverted with one command. Squash and rebase merges are disabled in the repo settings.

### Don't
- Don't fast-forward, squash or rebase into a permanent branch. The issue's commits then blend in as if made on `develop`, and nobody can tell which commits belonged to one issue.

## Agents in this repo
### Do
- Check `git status` and the current branch before the first edit, and again before every commit.
- Write commit messages that say what changed and why, in English.
- Report every commit you make (hash and one line) to the user.
- While working on an issue, push `feature/*`, `release-*` and `hotfix-*` branches and open PRs.
- Merge PRs, push tags, create releases and change repo settings only when the maintainer asks.
- Ask before any other action that leaves the machine or is hard to undo, such as deleting remote branches.

### Don't
- Don't push `main` or `develop` directly.
- Don't use `--force`, `reset --hard`, or `checkout -- .` on work you didn't create.
- Don't amend or rewrite commits that are already pushed or merged. Amending your own unpushed commit is fine.

## Releases and hotfixes
Cutting a release or shipping a hotfix: read [releasing.md](releasing.md) first.

## Cheat sheet
```
# start an issue (#<n>)
git checkout -b feature/<n>-<slug> develop

# finish it: cross-model review done; then ci-ok green
git push -u origin feature/<n>-<slug> && gh pr create --base develop --title "<summary>" --body "Closes #<n>. ..."
# maintainer, from the primary checkout:
gh pr merge <pr> -R decadance-dance/orca-plane --merge --delete-branch
git pull && git branch -d feature/<n>-<slug>
```
