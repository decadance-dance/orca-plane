# Proposal

## Why

A developer who tracks work in Plane cannot see their work items in Orca or start an agent on one. Today they copy keys, titles and descriptions by hand (#7).

Orca has built-in drawers for Linear and Jira but not for Plane. Upstream will add Plane "via extension" (stablyai/orca#8009). Plugins cannot add a native task source yet. So this plugin brings Plane in through its own sidebar panel.

## What Changes

- **New Orca plugin `plane`** with a sidebar panel and a worker. It uses `execution: trusted-worker` and `engines.orca >=1.4.259`.
- **Connect:**
  - Works with Plane Cloud or a self-hosted server, using a workspace slug and a personal access token.
  - The connection is held in one encrypted secret record, bound to its API origin.
  - Disconnect removes the record and the connection's cached data.
- **My open items:**
  - Lists the open work items assigned to me (state groups backlog, unstarted and started) across the workspace, through Plane API v2.
  - Items are grouped by state group.
  - A completeness state is always shown: complete, partial, stale or error.
- **Item detail:** key, title, state, priority, assignees, labels, last updated, the description as plain text, and a link to open the item in Plane.
- **Start:**
  - Creates an Orca workspace for an item, in a chosen Git project and with a chosen agent.
  - The prompt holds the item as fenced, untrusted data.
  - Start never creates a second workspace for the same item, and it recovers from lost replies and agent failures.
- **Status bar:** shows the count of my open items, `?` when the list is not complete, and nothing when disconnected.
- **Repo:**
  - Adds `LICENSE` (MIT), `NOTICE` (for code ported from stablyai/orca#29182, MIT), `README.md` and `docs/references.md`.
  - CI's pinned Orca version moves from 1.4.258 to at least 1.4.259, which is required for `workspace:create`.

### Out of scope (each has its own issue)

| Deferred | Issue |
|---|---|
| Change state, priority or assignees from Orca | #8 |
| Read and add comments | #9 |
| Create work items | #10 |
| Open an item by key or pasted URL | #11 |
| OAuth instead of a personal access token | #12 |
| Several connections at once | #13 |
| Plane servers without API v2 | #14 |
| Filters and search (cycles, modules, priority, text) | #15 |
| Exact branch name for started workspaces | #16 |
| Name the item in later agent prompts | #17 |
| Notify when an item's agent finishes | #18 |
| Offer only installed agents in Start | #19 |
| Agents reading and updating Plane (skill or MCP) | #20 |
| Listing in Orca's community catalog | #21 |

## Capabilities

### New Capabilities

- `plane-work-items`: Plane work items in Orca. This covers:
  - connecting to a Plane workspace and protecting the token;
  - listing my open items, with their completeness;
  - item detail;
  - starting an agent workspace for an item;
  - the status bar count.

### Modified Capabilities

None. There are no existing specs.

## Impact

- **New code:** `orca-plugin.json`, `src/` (worker, panel, Plane client, tests), `test/fixtures/`.
- **Capabilities the user approves when loading the plugin:**
  - `secrets:own`, `storage:own`, `settings:own`
  - `workspace:read`, `workspace:write`, `workspace:create`
  - `agent:launch`
  - `notifications:show`
- **External systems:** Plane API v2 at the connection's server: `users/me`, the workspace work-items list, and get one work item. All calls are read-only.
- **CI:** `.github/workflows/ci.yml` bumps `ORCA_VERSION` and `ORCA_SHA256`.
- **Rate limit:** Plane allows 60 requests per minute per API key. The plugin should use its own token, so it does not share that budget with other tools.
