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
- [ ] 1.5 Approval gate: show the maintainer the `inspect` access list and the `approval_required` data, and approve only after they say yes. Then run `bin/check`.
  - Verify: `bin/check` exits 0 on the scaffold.

## 2. Plane client

- [ ] 2.1 Port server URL normalization from #29182 into `src/plane/url.ts`, with a source header. Cover:
  - Cloud vs self-hosted;
  - API and app origins;
  - stripping `/api…`;
  - refusing `http:` off loopback and URLs with userinfo.

  Verify: `src/plane/url.test.ts` covers each case and passes under `orca plugin test .`.
- [ ] 2.2 Port HTML to text from #29182 into `src/plane/html.ts`.
  - Verify: tests for paragraphs, line breaks, entities and nested markup pass.
- [ ] 2.3 Write `src/plane/http.ts`, a connection-bound `fetch` per design D5:
  - headers;
  - `redirect: 'error'`;
  - origin check;
  - a 10 s timeout that covers the body read;
  - one 429 retry within 30 s;
  - the error kinds.

  Verify: tests with a fake `fetch` cover every rule, including no retry on a long wait, and that errors carry no request headers.
- [ ] 2.4 Write `src/plane/api.ts`:
  - `me()`;
  - `listMyOpenItems()`, which walks cursor pages and repeats filters, `order_by` and `per_page` on every page;
  - `getItem()`.

  Verify, in tests:
  - query strings match design D1;
  - two pages;
  - exactly 1,000 items with `has_more` false and true;
  - a repeated or malformed cursor gives `partial`;
  - a failing page n>1 gives `partial` plus the error.
- [ ] 2.5 Write `src/plane/map.ts`, which maps v2 payloads to the plugin's item model.
  - Verify: the probe fixtures in `test/fixtures/` map. An unexpanded state stays listed as unknown. An unknown priority becomes `none`.

## 3. Connection

- [ ] 3.1 Write `src/connection.ts`:
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
- [ ] 3.2 Validate on connect: `users/me` first, then one list page. Map failures to the spec's messages: invalid token, unknown workspace, unsupported server, unsafe URL.
  - Verify: one test per spec scenario of "Connect to a Plane workspace".
- [ ] 3.3 Refuse to connect when `secrets.protection` is `unavailable`.
  - Verify: a test asserts no secret and no storage write in that case.
- [ ] 3.4 Write the sentinel-token test: drive every worker handler with a sentinel token, using `mockHost` capture and a fake `fetch`.
  - Verify: the sentinel appears only on the permitted paths of the spec requirement "Token is never exposed".

## 4. Items and status bar (worker)

- [ ] 4.1 Implement the refresh model (design D4):
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
- [ ] 4.2 Implement `item.get`, which returns the detail with the description converted to text and the web URL `<appOrigin>/<slug>/browse/<KEY-N>/`.
  - Verify: tests use the item fixture.
- [ ] 4.3 Implement the status bar:
  - the count when the list is complete, `?` otherwise, hidden when disconnected;
  - the `refreshMinutes` timer, re-armed when the setting changes and stopped while disconnected.

  Verify: worker tests for each state and for the timer.

## 5. Start

- [ ] 5.1 Write `src/start.ts`:
  - the name `<KEY-N>-<title slug>` (ASCII, with a length cap);
  - the prompt builder with fencing and the 12,000-character cap (design D6).

  Verify: tests for slug edge cases, prompt contents, fence escaping and the truncation marker.
- [ ] 5.2 Implement the per-item Start state machine (design D3):
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
- [ ] 5.3 Implement the `orca.projects` handler (Git projects only, keeping `id` and `hostId`) and `workspace.open`.
  - Verify: tests on a `project.list` fixture that contains a folder project.
- [ ] 5.4 Do one real Start in a scratch Git project, and record the branch Orca derives from the name in `design.md` (Open Questions).
  - Verify: the recorded branch name, and the agent's prompt as seen in its terminal.

## 6. Panel

- [ ] 6.1 Build the Connect view: server (Cloud or self-hosted), slug, a masked token field cleared after submit, and the connection status with Disconnect.
  - Verify: panel tests for submit, each error message and the cleared field.
- [ ] 6.2 Build the List view: grouped by state group, completeness badge, refresh, and per-item Start state.
  - Verify: panel tests with mocked `items.list` and `start.changed` posts.
- [ ] 6.3 Build the Detail and Start views: detail fields, "Open in Plane", project and agent pickers, an editable prompt, a Start button that reflects the state, and "Open workspace".
  - Verify: panel tests, including an empty project list.
- [ ] 6.4 Add `src/panel.check.ts` states: disconnected, loading, complete, partial, stale, empty, error, detail, start pending, start unknown.
  - Verify: `orca plugin dev watch . --check --shot .orca/shots` shows no errors, and the PNG of each state reads correctly.

## 7. Integration

- [ ] 7.1 Run a live smoke test against the maintainer's Plane Cloud workspace.
  - Verify:
    - the keys in the panel equal Plane's "assigned to me, open" view while the panel says `complete`;
    - one real Start;
    - the status bar count.

    Screenshots go in the PR.
- [ ] 7.2 Run the full checks.
  - Verify: `bin/check` and `openspec validate --all` exit 0 locally, and `ci-ok` is green on the PR.
- [ ] 7.3 Get the cross-model review: a Codex session reviews the PR head from the diff, #7 and `git-flow.md`, runs `bin/check` and loads the plugin.
  - Verify: its GitHub review has no open must-fix findings.

## Workflow follow-up

- The maintainer merges the PR into `develop`.
- Archive `add-plane-work-items` with `openspec archive` on its own issue, branch and PR into `develop`. Then verify `openspec/specs/plane-work-items/spec.md` exists and `openspec validate --all` passes.
