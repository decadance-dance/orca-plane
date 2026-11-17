# Tasks

## 1. Scaffold and CI

- [x] 1.1 Scaffold with `orca plugin create <tmp> --template worker-panel --id plane --name "Plane"` and copy the files into the repo root.
  - Verify: `orca plugin validate . --json` exits 0.
- [x] 1.2 Write `orca-plugin.json`:
  - `engines.orca >=1.4.259`;
  - capabilities per proposal Impact;
  - panel `plane`;
  - status bar item;
  - settings `refreshMinutes` (integer 5–60, default 10) and `defaultAgent` (enum per design D8).

  Verify: `orca plugin inspect . --json` lists exactly those capabilities and contributions.
- [x] 1.3 Add `LICENSE` (MIT), `NOTICE` (Orca's MIT text, for code ported from stablyai/orca#29182), `README.md` (what it does, how to connect, use a separate token) and `docs/references.md`.
  - Verify: the files exist and `git grep -nE 'plane_api_[A-Za-z0-9]{8,}'` (a token value) finds nothing.
- [x] 1.4 Bump `ORCA_VERSION` and `ORCA_SHA256` in `.github/workflows/ci.yml` to a release that is 1.4.259 or newer. The sha256 comes from the downloaded release asset.
  - Verify: `sha256sum` of the asset matches the pinned value.
- [x] 1.5 Approval gate: show the maintainer the `inspect` access list and the `approval_required` data, and approve only after they say yes. Then run `bin/check`.
  - Verify: `bin/check` exits 0 on the scaffold.

## 2. Plane client

- [x] 2.1 Port server URL normalization from #29182 into `src/plane/url.ts`, with a source header. Cover:
  - Cloud vs self-hosted;
  - API and app origins;
  - stripping `/api…`;
  - refusing `http:` off loopback and URLs with userinfo.

  Verify: `src/plane/url.test.ts` covers each case and passes under `orca plugin test .`.
- [x] 2.2 Port HTML to text from #29182 into `src/plane/html.ts`.
  - Verify: tests for paragraphs, line breaks, entities and nested markup pass.
- [x] 2.3 Write `src/plane/http.ts`, a connection-bound `fetch` per design D5:
  - headers;
  - `redirect: 'error'`;
  - origin check;
  - a 10 s timeout that covers the body read;
  - one 429 retry within 30 s;
  - the error kinds.

  Verify: tests with a fake `fetch` cover every rule, including no retry on a long wait, and that errors carry no request headers.
- [x] 2.4 Write `src/plane/api.ts`:
  - `me()`;
  - `listMyOpenItems()`, which walks cursor pages and repeats filters, `order_by` and `per_page` on every page;
  - `getItem()`.

  Verify, in tests:
  - query strings match design D1;
  - two pages;
  - exactly 1,000 items with `has_more` false and true;
  - a repeated or malformed cursor gives `partial`;
  - a failing page n>1 gives `partial` plus the error.
- [x] 2.5 Write `src/plane/map.ts`, which maps v2 payloads to the plugin's item model.
  - Verify: the probe fixtures in `test/fixtures/` map. An unexpanded state stays listed as unknown. An unknown priority becomes `none`.

## 3. Connection

- [x] 3.1 Write `src/connection.ts`:
  - the single secret record;
  - `connectionId`;
  - the connect lock;
  - the generation counter;
  - clearing other ids' storage on connect;
  - the disconnect cleanup (design D2).

  Verify, in tests:
  - one `secrets.set` per connect;
  - a failed write leaves no connection;
  - concurrent connects run in order;
  - an account switch clears the old items and links;
  - a result after disconnect is discarded.
- [x] 3.2 Validate on connect: `users/me` first, then one list page. Map failures to the spec's messages: invalid token, unknown workspace, unsupported server, unsafe URL.
  - Verify: one test per spec scenario of "Connect to a Plane workspace".
- [x] 3.3 Refuse to connect when `secrets.protection` is `unavailable`.
  - Verify: a test asserts no secret and no storage write in that case.
- [x] 3.4 Write the sentinel-token test: drive every worker handler with a sentinel token, using `mockHost` capture and a fake `fetch`.
  - Verify: the sentinel appears only on the permitted paths of the spec requirement "Token is never exposed".

## 4. Items and status bar (worker)

- [x] 4.1 Implement the refresh model (design D4):
  - a cache under the connection id;
  - `items.list` answers from the cache at once;
  - one shared refresh with a 90 s deadline;
  - the `items.changed` post;
  - completeness states.

  Verify, in tests:
  - `items.list` resolves before a slow refresh ends;
  - joined refreshes;
  - a closed panel still gets the result stored;
  - stale after a failure.
- [x] 4.2 Implement `item.get`, which returns the detail with the description converted to text and the web URL `<appBase>/<slug>/browse/<KEY-N>/`.
  - Verify: tests use the item fixture.
- [x] 4.3 Implement the status bar:
  - the count when the list is complete, `?` otherwise, hidden when disconnected;
  - the `refreshMinutes` timer, re-armed when the setting changes and stopped while disconnected.

  Verify: worker tests for each state and for the timer.

## 5. Start

- [x] 5.1 Write `src/start.ts`:
  - the name `<KEY-N>-<title slug>` (ASCII, with a length cap);
  - the prompt builder with fencing and the 12,000-character cap (design D6).

  Verify: tests for slug edge cases, prompt contents, fence escaping and the truncation marker.
- [x] 5.2 Implement the per-item Start state machine (design D3):
  - `item.start` answers `accepted`;
  - `workspace.create` runs in the background;
  - `pending`→`unknown` on worker start;
  - reconcile through `workspace.list`;
  - `failed` with a workspace id;
  - the deleted-link fallback;
  - the `start.changed` post.

  Verify, in tests:
  - a double press from two panels;
  - a lost reply;
  - restart then reconcile, both found and not found;
  - an agent failure after create;
  - a create failure;
  - a deleted workspace.
- [x] 5.3 Implement the `orca.projects` handler (Git projects only, keeping `id` and `hostId`) and `workspace.open`.
  - Verify: tests on a `project.list` fixture that contains a folder project.
- [x] 5.4 Moved to #24. Do one real Start in a scratch Git project, and record the branch Orca derives from the name in `design.md` (Open Questions).
  - Verify: the recorded branch name, and the agent's prompt as seen in its terminal.

## 6. Panel

- [x] 6.1 Build the Connect view: server (Cloud or self-hosted), slug, a masked token field cleared after submit, and the connection status with Disconnect.
  - Verify: panel tests for submit, each error message and the cleared field.
- [x] 6.2 Build the List view: grouped by state group, completeness badge, refresh, and per-item Start state.
  - Verify: panel tests with mocked `items.list` and `start.changed` posts.
- [x] 6.3 Build the Detail and Start views: detail fields, "Open in Plane", project and agent pickers, an editable prompt, a Start button that reflects the state, and "Open workspace".
  - Verify: panel tests, including an empty project list.
- [x] 6.4 Add `src/panel.check.ts` states: disconnected, loading, complete, partial, stale, empty, error, detail, start pending, start unknown.
  - Verify: `orca plugin dev watch . --check --shot .orca/shots` shows no errors, and the PNG of each state reads correctly.

- [x] 6.5 Carry label names into list items in `src/plane/map.ts`; read a cache without them as no labels (design D4).
  - Verify: the list fixture maps its labels; an old cache entry without `labels` renders.
- [x] 6.6 Rebuild the List view per design D10: search, Project and Agent pickers at the top, collapsible groups with counts, rows with priority and label badges and Open and Start buttons that follow the Start state.
  - Verify: panel tests for search by key, title and label, no match with Clear search, group counts, and each row Start state.
- [x] 6.7 Add the Start confirmation from a row and from the detail: name, project, agent, editable prompt; Confirm sends `item.start`, Cancel creates nothing.
  - Verify: panel tests for confirm, cancel, an edited prompt and an empty project list.
- [x] 6.8 Moved to #24. Update `src/panel.check.ts` for the new layout, adding `search` and `confirm` scenarios, with items from two projects so the tabs show, and shoot every scenario again.
  - Verify: `orca plugin check .` shows no issues, and the PNG of each scenario reads correctly.
- [x] 6.9 Start the detail with `← All items` (design D10). The row's title stays text and Open stays a button (a title link was tried and reverted at the maintainer's request).
  - Verify: panel tests for Open and going back.
- [x] 6.10 Convert the description to Markdown in `src/plane/markdown.ts`, draw it with `Markdown`, and use it in the prompt; remove `src/plane/html.ts` (design D11).
  - Verify: tests for paragraphs, headings, nested and task lists, marks, code blocks, links (unsafe targets dropped), quotes and entities; a panel test that the detail draws `Markdown`.
- [x] 6.11 Move the Project and Agent pickers from the top of the list into the Start confirmation (design D10).
  - Verify: panel tests that no picker shows before Start, and that the confirmation's choices reach `item.start`; no Git projects shows the hint and disables Confirm.
- [x] 6.12 Add `agents.installed` in the worker (design D8) and offer only those agents, plus terminal only.
  - Verify: tests for found commands, none found and a failed check; a panel test that the Agent options are the installed ones.
- [x] 6.13 Split the List view into one tab per Plane project (design D10): the label is the key prefix with the count of shown items, tabs ordered by label, the selected tab persisted as `plane.tab` with a fallback to the first; state groups inside the tab; search across all projects.
  - Verify: panel tests for two projects in two tabs, the label counts with and without search, the remembered tab, the fallback when its project is gone, and an empty selected tab under search.
- [x] 6.15 Group each tab's items by state name instead of state group (design D10): ordered by Plane group, then item count, then name; unknown state last.
  - Verify: panel tests for the order of several states in one group, the counts, an unknown state last, and search keeping the order.
- [x] 6.16 Make the row's priority and label tags toggle a filter (design D10, spec "Filter by a tag"): tag buttons below the pressable row, active ones filled, every active tag must match, persisted as `plane.tags`, cleared by Clear search.
  - Verify: panel tests for filtering by a label and by a priority, two tags together, pressing an active tag again, the tab counts, the remembered tags and Clear search.
- [x] 6.17 Draw the low priority tag in the `accent` tone (design D10, #28): Orca draws a `success` border at 25% opacity, so the low tag was barely visible.
  - Verify: the panel test for the priority tones expects `accent` for low.
- [x] 6.14 Moved to #24. Restyle the List view after Orca's Agents panel (design D10): header, status line, segmented project switcher, count bar, rows with icon buttons and a meta line.
  - Verify: panel tests updated for the new controls (row actions by their accessible names, the switcher selects and persists the tab); a live shot of the panel read with the maintainer.

## 7. Integration

- [x] 7.1 Moved to #24. Run a live smoke test against the maintainer's Plane Cloud workspace.
  - Verify:
    - the keys in the panel equal Plane's "assigned to me, open" view while the panel says `complete`;
    - one real Start;
    - the status bar count.

    Screenshots go in the PR.
- [x] 7.2 Run the full checks.
  - Verify: `bin/check` and `openspec validate --all` exit 0 locally, and `ci-ok` is green on the PR.
- [x] 7.3 Get the cross-model review: a Codex session reviews the PR head from the diff, #7 and `git-flow.md`, runs `bin/check` and loads the plugin.
  - Verify: its GitHub review has no open must-fix findings.

## Workflow follow-up

- The maintainer merges the PR into `develop`.
- Archive `add-plane-work-items` with `openspec archive` on its own issue, branch and PR into `develop`. Then verify `openspec/specs/plane-work-items/spec.md` exists and `openspec validate --all` passes.
