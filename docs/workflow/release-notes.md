# Release notes
Read when: drafting `RELEASE-<ver>.md` (local, never committed) for a release or hotfix.
TL;DR: The agent writes the whole release body: a short version for readers who stop after six lines, upgrade notes, then every PR grouped by area. `gh release create --notes-file` publishes it as written; nothing is generated.

Model: the Orca releases (https://github.com/stablyai/orca/releases).

## Template
```
Orca Plane <ver>

## The short version

- **<Benefit in a few words>:** <what changed for the user, one or two sentences>.
- ...

## Compatibility & upgrade notes

**<Area>:** <what a user must do or know: a new minimum Orca version, settings to re-enter, changed behaviour>.

---

## Changes

### <Area>

*<One sentence: what this area gained in this release.>*

* **<label>** <PR title> by @<author> in https://github.com/decadance-dance/orca-plane/pull/<N>
* ...

**Full Changelog**: https://github.com/decadance-dance/orca-plane/compare/<prev>...<ver>
```

## Do
- Collect the input: PRs merged since the last tag (`gh pr list --base develop --state merged --search "merged:>=<last tag date>" --json number,title,author,labels`) and the issues with milestone `<ver>` (`gh issue list --milestone <ver> --state closed`) ([releasing.md](releasing.md), Release branch).
- Use the issues for "The short version" and the area sentences; the PR list stays the source for the per-PR lines.
- Write "The short version" as 3-6 bullets, each starting with a bold benefit. Say what a user gets, not which files changed.
- Start every PR line with the PR's labels in bold: `enhancement`, `bug`, `documentation`, `dependencies` (`* **bug** <PR title> ...`). A PR without one of these labels gets no prefix.
- Put every merged PR in exactly one area: for example Panel, Plane API, Settings, Docs & workflow, Tests & maintenance. Drop an area that has no PRs; add one when a release needs it.
- Write "Compatibility & upgrade notes" only when there is something to do or know; otherwise drop the section.

## Don't
- Don't list commits or file paths in the short version.
- Don't pass `--generate-notes` to `gh release create`: it would append a second, ungrouped PR list.
