# Releases and hotfixes
Read when: cutting a release, shipping a hotfix, bumping the version, or tagging `main`.
TL;DR: A `release-<ver>` branch comes off `develop`, a `hotfix-<ver>` branch off `main`. Each gets its own release issue, a PR into `main`, a plain `X.Y.Z` annotated tag on `main`, a GitHub Release with the notes, and a PR back into `develop`. Every release and hotfix bumps `version` in `orca-plugin.json`. Branch basics and the task-branch rules: [git-flow.md](git-flow.md). A closed issue stays closed after a release: new work gets a new issue.

## Release branch (`release-*`)
### Do
- Cut it when `develop` has collected enough: `git checkout -b release-1.2.0 develop`.
- Limit it to small bug fixes, the version bump and the release notes. New work keeps going to `develop` in parallel.
- Give the release its own issue (`Release 1.2.0`). Its checklist holds only what is done before the PR into `main` merges: version bumped in `orca-plugin.json`; shipped issues marked; notes ready; `ci-ok` green on the draft PR. The steps after the merge (tag, GitHub Release, PR into `develop`, deleting the branch) go in the issue as notes.
- Mark the shipped issues: every issue closed as completed since the last release, and the release issue itself, get the milestone `<ver>` (`gh issue edit <n> --milestone 1.2.0`; create it once with `gh api repos/decadance-dance/orca-plane/milestones -f title=1.2.0`). Issues closed as not planned are never marked: they did not ship. Their titles and the PRs that closed them are the notes' input.
- Draft the release notes: write the whole body into a local file, `RELEASE-<ver>.md`, by the template in [release-notes.md](release-notes.md). The maintainer edits it. Never commit it: keep it outside the repo.
- Open a draft PR into `main` (`gh pr create --draft --base main --title "Release 1.2.0" --body "Refs #<release issue>"`). When `ci-ok` is green, tick the last item and mark it ready (`gh pr ready`).
- After that PR merges, the maintainer tags `main`, pushes the tag and publishes the GitHub Release:
  ```
  git checkout main && git pull
  git tag -a 1.2.0 -m "Orca Plane 1.2.0"
  git push origin 1.2.0
  gh release create 1.2.0 --verify-tag --title "Orca Plane 1.2.0" --notes-file RELEASE-1.2.0.md
  ```
- Once the plugin is listed in the Orca community catalog, run `orca plugin release-entry .` on the tagged `main` and add the printed entry to the catalog by its own PR.
- Then open a PR from the same branch into `develop` (`gh pr create --base develop --head release-1.2.0 --title "Release 1.2.0 into develop" --body "Closes #<release issue>"`). If it conflicts, branch `merge/1.2.0` off `develop`, merge `release-1.2.0` into it, resolve, and PR `merge/1.2.0` into `develop` with the same title.
- Delete the release branch after both PRs have merged.

### Don't
- Don't add new features in a release branch.
- Don't skip the PR back into `develop`, or the fixes made during the release are lost in the next one.
- Don't tag with a `v` prefix, a suffix (`1.2.0-rc.1`) or a lightweight tag: plain annotated `X.Y.Z` tags only.
- Don't pass `--generate-notes` to `gh release create`: it would append a second, ungrouped PR list.

## Hotfix branch (`hotfix-*`)
### Do
- Use it only when something broke for users and the next release cannot wait. It is the only branch that comes off `main`: `git checkout -b hotfix-1.2.1 main`.
- Give it its own issue by the release issue template above (checklist before the merge, post-merge steps as notes) and mark only the hotfix issue with milestone `1.2.1`: the closed issues waiting on `develop` ship with the next release.
- Finish it like a release: a PR into `main`, the tag and the GitHub Release on `main`, then a PR from the same branch into `develop`.

### Don't
- Don't use a hotfix for planned work or features.
- Don't forget the PR into `develop`.

## Release numbers
### Do
- Use `MAJOR.MINOR.PATCH` (for example `1.4.2`):
  - patch +0.0.1 when a `hotfix-*` ships;
  - minor +0.1.0 when a `release-*` ships with features;
  - major +1.0.0 when a release breaks users: settings or stored data that do not carry over, or a higher minimum Orca version (`engines.orca`).
- Stay on `0.x` until the first release listed in the Orca catalog.
- Keep the tag and `version` in `orca-plugin.json` equal: the release branch bumps it in a separate commit.

## Cheat sheet
```
# release a version
git checkout -b release-1.2.0 develop
# release issue #<r>; milestone 1.2.0 on it and on every issue completed since the last release
# version bump in orca-plugin.json; RELEASE-1.2.0.md drafted and edited (never committed)
git push -u origin release-1.2.0 && gh pr create --draft --base main --title "Release 1.2.0" --body "Refs #<r>"
# ci-ok green: tick the checklist, then gh pr ready
# maintainer:
gh pr merge --merge
git checkout main && git pull && git tag -a 1.2.0 -m "Orca Plane 1.2.0" && git push origin 1.2.0
gh release create 1.2.0 --verify-tag --title "Orca Plane 1.2.0" --notes-file RELEASE-1.2.0.md
gh pr create --base develop --head release-1.2.0 --title "Release 1.2.0 into develop" --body "Closes #<r>"   # then merge it
git push origin --delete release-1.2.0 && git branch -d release-1.2.0

# urgently fix a release
git checkout -b hotfix-1.2.1 main
# hotfix issue, milestone 1.2.1 alone (develop's closed issues wait for the next release)
# same finish as a release: PR into main, tag and GitHub Release on main, PR into develop, delete the branch
```
