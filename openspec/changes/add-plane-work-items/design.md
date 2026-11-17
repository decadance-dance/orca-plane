# Design

## Context

The repo has no plugin code yet. The `bin/check` and CI scaffolding exist; CI pins Orca 1.4.258. Motivation is in `proposal.md`, and the behavior is in `specs/plane-work-items/spec.md`.

Constraints that shape the approach:

- **Orca plugin model** (`orca skills get orca-plugin-authoring`):
  - A `trusted-worker` worker is the only part that has network access.
  - A components panel (TSX, `"ui": "components"`) talks to the worker through requests and posts.
  - A panel request times out after 30 s by default, 120 s at most.
  - There is no build step. A worker restart drops its in-memory state.
- **Host API used:**
  - `secrets.*` and `secrets.protection`
  - `storage.*` and `settings.*`
  - `project.list`, `workspace.list`, `workspace.open`, `workspace.create`
  - `statusBar.update` and `notifications.show`
  - `workspace.create` needs capability `workspace:create`, available since Orca 1.4.259. Starting an agent from it also needs `agent:launch`.
  - `workspace.create` takes `{projectId, hostId?, name?, baseBranch?, agent?, prompt?, setup?, open?}`. It has no branch and no reference parameter.
  - `agents.list` lists only the agents running in the focused workspace, so it cannot fill an agent picker.
- **Plane API v2**, per developers.plane.so and confirmed by the probe on Plane Cloud, workspace `truelogic` (#7). The probe findings follow.

### Plane API v2 probe findings

**Calls.**
- `GET /api/v2/users/me/` returns `{id, display_name, email, principal_kind, scopes, …}`.
- `GET /api/v2/workspaces/{slug}/work-items/` is used with:
  - `assignee_id=<me>`
  - `state_group__in=backlog,unstarted,started`
  - `expand=state,assignees,labels`
  - `order_by=-updated_at`
  - `paginate=cursor`, `per_page` up to 200
- That call returns `{data, next_cursor, has_more, pagination:{style:"cursor"}}`.
- A cursor encodes only the position, so later pages repeat every filter.
- `GET /api/v2/workspaces/{slug}/projects/{project_id}/work-items/{KEY-N}/?expand=…` includes `description_html`.

**Payloads.**
- Rows carry `identifier` (the full key, e.g. `DIOGEN-449`).
- With `expand`, `state` is an object that has `group`, and `assignees` and `labels` are arrays.
- List rows have no description.

**Errors and limits.**
- An unknown slug gives 404 `{"error":…}`.
- The rate-limit headers are `x-ratelimit-remaining` (60 per minute per key) and `x-ratelimit-reset` (epoch seconds).

**The maintainer's workspace.**
- 186 open assigned items, which fit one 200-item page.
- The web URL `https://app.plane.so/{slug}/browse/{KEY-N}/` opens the item.

## Goals / Non-Goals

**Goals:**
- Every Plane request is made by the worker, with a connection object passed explicitly. There is no global token.
- The panel never blocks on the network for the list and never sees the token.
- Every state the worker owns is safe across worker restarts, several open panels and connection switches. That covers the cache, links and Start state.
- Code ported from upstream is limited to two small pure modules.

**Non-Goals:**
- No Plane API v1 client and no v1/v2 payload mixing (#14).
- No writes to Plane.
- No native Orca task source: plugins cannot add one yet.
- No CLI fallback for Start; the host API covers it.

## Decisions

### D1. Plane API v2 only
- One server-filtered, workspace-wide list call replaces v1's scan of every project, its client-side assignee filter and its state and member lookups.
- *Alternative:* v1, the approach the native PRs took. It needs about one request per project per refresh and metadata calls, risks incomplete lists under the cap, and is still the only API on old self-hosted servers. Deferred to #14.

### D2. Connection is one encrypted record
- `secrets` holds a single JSON record, `{token, apiBase, appBase, hostKind, slug, userId, userName}`, written with one `secrets.set`. A failed write leaves no half-saved connection.
  - `apiBase` and `appBase` are an origin plus the install's path prefix, if a self-hosted server has one. Requests are bound to the origin of `apiBase`.
- `connectionId = sha256(apiBase + "\n" + slug + "\n" + userId)` keys every storage entry, as `c:<connectionId>:<name>`.
- **Connect** runs one at a time, under an in-worker lock:
  1. validate the new destination (`users/me`, then one list page);
  2. write the record;
  3. bump the generation counter;
  4. delete the storage entries of other connection ids;
  5. clear the status bar.
- **Disconnect** deletes the record, aborts the in-flight `AbortController`, bumps the generation counter, deletes that id's entries and clears the status bar.
- A result tagged with an older generation is dropped.
- *Alternative:* URL and slug in plugin settings, the token in secrets. Rejected after review: a settings change could send the old token to a new origin, and the two stores cannot be written atomically.

### D3. Start runs in the background through host `workspace.create`
- `item.start` stores `pending {name, projectId, startedAt}` for the item under the connection id, answers `accepted` and runs the create.
- Per-item states: `idle`, `pending`, `created {workspaceId}`, `failed {error, workspaceId?}` and `unknown {name, projectId}`.
- On worker start, any `pending` becomes `unknown`. A throw without a clear result also becomes `unknown`.
- Before Start is offered again for an `unknown` item, `workspace.list` is searched in that project for a workspace with the recorded name. A match becomes `created`; no match becomes `idle`.
- When the host reports an agent failure that names a workspace id, the item becomes `failed` with that id, and "Open workspace" is offered.
- When the item is shown, a `created` link is checked against `workspace.list`; a missing workspace falls back to `idle`.
- The result is posted as `start.changed`.
- *Alternative:* the `orca worktree create` CLI with `--branch` and `--reference`, as the Redmine and YouTrack plugins do. Rejected: it needs binary discovery and was only a workaround for Orca < 1.4.259.
- *Alternative:* a synchronous `item.start` request. Rejected: setup and the agent launch can exceed the panel request timeout.

### D4. Refresh model
- The cache `{items, completeness, fetchedAt, error}` is kept under the connection id. List items carry their label names; a cache written before that reads as items with no labels.
- `items.list` returns the cache at once. It starts a refresh when the cache is older than 60 s or `force` is set.
- One refresh runs at a time and later triggers join it. A refresh belongs to the worker, not to the panel that asked.
- Limits:
  - an overall deadline of 90 s;
  - a 10 s timeout per request, covering the body read;
  - at most 5 pages × 200 items.
  - Hitting the cap with `has_more`, or a repeated or malformed cursor, gives `partial`.
  - A failed page after page 1 gives `partial` plus the error. A failed refresh while a cache exists gives `stale`.
- The timer runs every `refreshMinutes` (minimum 5, default 10). It is re-armed when that setting changes, and it does not run while disconnected.
- *Alternative:* the panel waits for a fresh list. Rejected: a refresh with retries can exceed 30 s.

### D5. HTTP layer
- Every request is built from the connection. Headers are `X-API-Key` and `Accept: application/json`, with `redirect: 'error'`, and the origin must equal the origin of `apiBase`.
- On 429, a GET is retried once when the wait (`Retry-After`, else `x-ratelimit-reset` minus now) is 30 s or less and fits the deadline.
- Errors are classified as `auth` (401), `forbidden` (403), `not_found` (404), `rate_limited` (429), `unsupported_server`, `network`, `timeout` and `bad_response`.
  - `unsupported_server` is an HTML answer, or a 404 on `users/me`, which needs no slug.
  - Error objects carry the status and the server's `error`/`detail` text, never the request headers.
- Connect sends `users/me` first, so that a 404 there means no v2 and a 404 on the list means an unknown slug.

### D6. Prompt fencing
- A fixed header line and a fixed footer line wrap the title and the description text. Ticket lines that equal either line get a leading `\`.
- The block is capped at 12,000 characters with `[truncated]`. Orca uses the same limit for its own integrations.
- This is guidance for the agent, not an injection guarantee.

### D7. Port only pure modules from stablyai/orca#29182 (`b86a6e39`, MIT)
- The module is server URL normalization and origin rules (`src/shared/plane-url.ts`). HTML to text (`src/main/plane/plane-comment-html.ts`) was ported first and then replaced by D11.
- Each ported file gets a header naming its source, and `NOTICE` carries Orca's MIT text.
- *Alternative:* port the whole client, which is v1-centric and coupled to Electron. Rejected by D1.

### D8. Agents found on this computer
- No host API lists installed agents: `agents.list` lists only the agents running in the focused workspace (#19).
- The worker knows a fixed table of Orca agent ids and their commands: `claude`, `codex`, `gemini`, `opencode`, `cursor` (`cursor-agent`), `copilot`, `qwen-code` (`qwen`), `droid` and `kimi`.
- Once per worker run it asks the person's login shell (`$SHELL -lc`, else `/bin/zsh`) which of those commands exist (`command -v`), with a 5 s timeout, and answers `agents.installed` with those agents. The script is fixed text: no input reaches it.
- No command found, a failed check, or Windows: every known agent is offered.
- Start offers those agents plus terminal only. The default is the `defaultAgent` setting when it is offered, else the first one offered; the last choice is remembered.
- Limits: only this computer is checked, so an SSH project's host is not; an agent that Orca launches through some other command is not seen.
- *Alternative:* the agents in Orca's Agent Session History (`agent.listSessions`). Rejected: it needs `history:read`, and an agent never run in Orca would be missing. A fixed list was the first version; the maintainer asked for installed agents only (2026-11-16).

### D9. Status bar press toggles the right sidebar
- The status bar item runs a declarative command with the built-in action `sidebar.right.toggle`; it needs no worker code.
- Orca has no action or host API that opens one plugin panel. The Plane panel shows when it is the selected tab of the right sidebar.
- *Alternative:* the worker runs `orca plugin open <key> --panel plane` through the CLI, as orca-redmine does. Rejected: it brings back binary discovery (maintainer's choice, 2026-11-16).

### D10. Panel layout follows backlog-md-orca
- The panel stays a components panel in the right sidebar. Its layout follows the community plugin backlog-md-orca (maintainer's choice, 2026-11-16).
- Top, from the top down, after Orca's Agents panel (maintainer's choice, 2026-11-17): a header with the title "Plane", the muted line `user · workspace`, and Refresh and Disconnect on the right; the search field without a visible label; a status line with the completeness badge and the update time; the project switcher; a muted bar with the selected project's shown count and "Last updated".
- The project switcher has one tab per Plane project (maintainer's choice, 2026-11-17): a segmented row of buttons in a muted, rounded box that fills its width: each segment grows, and the row wraps to more lines, each filled, when they do not fit. The selected one is outlined, the others are ghost buttons. Orca `Tabs` were tried and dropped: they scroll sideways and cut the labels off. A tab's value is the item's `projectId`; its label is the key prefix (the key up to its last `-`) of its newest item, which Plane keeps unique per workspace (older items can keep an old prefix after the project's identifier changes), plus the count of shown items, e.g. `DIOGEN 3`. Tabs are ordered by label. There is no "All" tab, and tabs show even for one project. The selected tab is persisted like the search (`plane.tab`); a project no longer listed falls back to the first tab. Project names would need Plane's projects endpoint (one more request per refresh, not probed), so the prefix is used.
- Inside the selected tab, one `Collapsible` per state, titled by the state's name, with its count (maintainer's choice, 2026-11-17: a Plane project can put several states, such as In Review and Blocked, in one group). States are ordered by Plane group (started, unstarted, backlog), then by their item count in the tab (the loaded items, so a search does not reorder them), then by name; an unknown state comes last. Items already carry `stateName` and `stateGroup`, so this needs no new request; Plane's own state order would need one states request per project. Each row is a pressable `ListItem` that opens the item detail, highlighted on hover like the Agents panel's rows (maintainer's choice, 2026-11-17; it replaced an Open arrow button). It holds the title in medium weight (text, not a link) and, below it, a muted line: `KEY · state · priority · labels · <relative update time>`; a failed Start adds a danger badge. A pressable `ListItem` cannot hold other controls, so Start is a small icon button beside it, named by its tooltip, which follows the item's Start state: play; a disabled play while Starting… or Checking…; open-external for Open workspace.
- Type follows the Agents panel as closely as Orca's `Text` sizes allow (`xs` 12px, `sm` 14px, `md` 16px; Agents uses 11, 12 and 13px): the header, the meta lines, the update time and the count bar are `xs`, the header title and the count semibold; row titles are `sm` medium; the project switcher and Disconnect are `xs` buttons. `Collapsible`, `Input` and `Button` text is drawn by Orca and cannot be resized.
- The detail starts with a `← All items` button back to the list. Orca's icon set has no back icon, so the arrow is part of the text.
- Start, from a row or the detail, shows a confirmation in place of that row's or the detail's buttons, so it appears where the person pressed, even deep in a long list: the Project and Agent pickers (D8), the workspace name, and the prompt in an editable field, built from `item.get`. A missing Git project shows a hint there and disables Confirm. Confirm sends `item.start`; Cancel creates nothing. The open confirmation is remembered like the open item (`plane.confirm`).
- Search filters the loaded list of every project in the panel, by key, title or label, ignoring case. The tab labels carry the counts of matches, so a key from another project shows where it is. The search text is remembered per panel.
- *Alternative:* an html panel like beads-orca, with views, filters, a table and a board. Rejected for now: a rewrite with its own design that needs a wide window. Filters stay in #15.

### D11. The description is Markdown
- The worker converts `description_html` to GitHub-flavoured Markdown (`src/plane/markdown.ts`): paragraphs, headings, nested and task lists, bold, italic, strikethrough, inline code and code blocks, links, quotes and rules. Other tags keep their text.
- The panel draws it with Orca's `Markdown`, which sanitizes it and opens links like `Link`. Images must be plugin files there, so a Plane image shows as its alt text.
- Links keep only `http`, `https` and `mailto` targets; any other target keeps its text without the link.
- The Start prompt carries the same Markdown inside its fence (D6).
- *Alternative:* plain text, split into paragraphs. Rejected after use: lists, headings and line breaks ran together into one block.

## Risks / Trade-offs

- **The branch name is Orca's derivation of `name`, which may add a user prefix.** → Measure it on the first real Start (task 5.4) and record it here. Exact names are #16.
- **Reconcile by name can adopt a workspace the user made by hand with the same name.** → Accepted: the result is "Open workspace", never a second create.
- **The rate-limit budget is shared with other tools that use the same token** (for example `apw`). → The README tells users to create a separate token. A refresh costs 1–5 requests.
- **Upstream may ship native Plane support later.** → The plugin stays useful until then and does not touch Orca's internals.
- **Self-hosted servers older than v2 cannot connect.** → They get a clear `unsupported_server` message, and #14 tracks v1 support.

## Migration Plan

A new plugin, so there is nothing to migrate.

- **Rollback:** disable or remove the plugin in Orca. This deletes its secrets and storage.
- **CI:** the Orca version bump ships in the same change.

## Open Questions

- Is the id `workspace.create` returns the same id `workspace.list` rows carry? Until task 5.4 confirms it, a linked workspace counts as existing when a row has its id, or its recorded name in its project.

- What exact branch name does Orca derive from `name` with the maintainer's settings? This is measured during task 5.4. It does not change the spec, which only names the workspace.
