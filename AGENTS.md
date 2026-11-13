# orca-plane: project instructions

These rules hold for every contributor and every coding agent. They need git, the `gh` CLI, Orca with its `orca` CLI on `PATH`, and the `openspec` CLI; no particular agent, plugin or task tool.

Write documentation and code comments in English.

Orca Plane is an Orca plugin that brings Plane work items into Orca. Layout: `orca-plugin.json` (the manifest, once the plugin exists), `openspec/` (specs and changes), `docs/workflow/` (git-flow, releases, release notes), `bin/check` (the project check), `.github/workflows/ci.yml` (CI). How Orca plugins are built: `skill-guides/orca-plugin-authoring.md` in [stablyai/orca](https://github.com/stablyai/orca).

## Read before
- The first commit or PR: [git-flow.md](docs/workflow/git-flow.md). Branches, merges through GitHub PRs (merge commit), what agents may commit or push.
- Cutting a release, shipping a hotfix, bumping the version or tagging `main` (the maintainer's job): [releasing.md](docs/workflow/releasing.md).

## Before you change anything
1. Work on a GitHub issue of this repo, on its own branch `feature/<n>-<slug>` off `develop`. No issue yet? Even a small fix gets one first.
2. Orient before you plan. An issue names a symptom or one fix; it does not carry the project around it. This step is for an issue that changes code, specs or the workflow; any other (a typo, a version bump, a release) records `Fit: n/a (<why>)` and moves on. Read the specs of the capabilities it touches in `openspec/specs/`, the Orca plugin docs for the host API, hook or component it uses, and look in the plugin's code for a mechanism that already does part of the job. Then record the fit as a comment on the issue before the first code change, in 3 to 5 lines starting with `Fit:`: which specs and docs govern it; whether it changes behavior (then it goes through OpenSpec); and where the issue's wording or suggested fix conflicts with the project. Raise a conflict with the user before you write code; don't silently follow the issue or silently override it. With no one there to answer (an unattended run), the conflict is a decision only the user can make: record it in the fit comment and stop.

## Specs
Behavior lives in OpenSpec: `openspec/specs/<capability>/spec.md` is the source of truth.
- A behavior change goes through an OpenSpec change in `openspec/changes/`: propose it, implement its tasks, and archive it after the merge into `develop` (the `openspec` CLI; the `openspec-*` skills where your agent has them).
- Design notes belong in the change's `design.md`.
- Check: `openspec validate --all`.

## Checks
- `bin/check`: validates the plugin, renders its panels and runs its tests (`orca plugin check .`, `orca plugin test .`).
- `openspec validate --all`.
- Run both before you say a change is done. CI (`ci-ok`) is the merge gate.

## Issues
Tasks, briefs and open follow-ups live in GitHub Issues of this repo. Deferred work becomes a new issue. A new issue states the outcome and the evidence, not the implementation: what is wrong or missing, for whom, and how to see it. A fix you have in mind goes in as "one option", not as the issue. Name the context the next session needs, in one `Context:` line in the description: the capability spec, the Orca doc or the issue it came from. A PR that finishes an issue says `Closes #<n>` in its description; one that only touches it says `Refs #<n>`.
