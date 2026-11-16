# References

Collected while planning #7 (2026-11-13 to 2026-11-16). Historical notes: where they differ from
`openspec/changes/add-plane-work-items/design.md`, the design wins (it chose Plane API v2; the v1
notes below are kept for #14).


Collected 2026-11-13. Nothing here was run against a live Plane server unless marked "docs".

## Why a plugin, not a native PR

Issue [stablyai/orca#8009](https://github.com/stablyai/orca/issues/8009): a maintainer answered "@nwparker is working on an extension system. will support it via extension". Four native Plane PRs (#14692, #15329, #20413, #29182) have had no human maintainer review since.

Plugin limit: Orca's "task sources" (the built-in Linear/Jira items drawer) are reserved and not buildable by plugins yet. Plane lives in our own sidebar panel.

## Orca plugin docs (stablyai/orca, `main`)

- `skill-guides/orca-plugin-authoring.md`: shapes, dev loop, ship steps, gotchas
- `skill-guides/orca-plugin-authoring/references/{workflow,host-api,recipes,manifest,components,events,testing,cli}.md`
- `docs/reference/plugin-listing-policy.md`: listing rules (free, publisher = repo owner, no brand impersonation)
- `examples/plugins/hello-worker-panel`, `hello-tsx`
- Manifest schema: `docs/schemas/plugins/orca-plugin.v2.schema.json`
- Local CLI: `/Applications/Orca.app/Contents/Resources/bin/orca plugin create|dev watch|test|check|validate|release-entry`
- Catalog: [stablyai/orca-community-plugins](https://github.com/stablyai/orca-community-plugins) (`orca-catalog.json`, `directory.json` stars)

Shape for us: `execution: trusted-worker`, `engines.orca >=1.4.248`, worker `main` (only the worker has network), panel `.tsx` with `"ui": "components"`.
Capabilities: `secrets:own`, `settings:own`, `storage:own`, `workspace:read`, `workspace:write`, `agent:launch`, `notifications:show`.

Host API we need: `workspace.create` (with `agent`), `agent.launch`, `workspace.list`, `project.list`, `statusBar.update`, `notifications.show`.
Hooks and events: `workspace.create.before` (branch name), `agent.prompt.before` (task pointer), `agent.status.changed`.

## Reference plugins

| Plugin | Repo | Take from it |
|---|---|---|
| Redmine | [plozmun/orca-redmine](https://github.com/plozmun/orca-redmine) | Skeleton: REST + API key in secrets, task to workspace links, all hooks, TS + tests |
| YouTrack | [maxfedorov/youtrack-for-orca](https://github.com/maxfedorov/youtrack-for-orca) | Start view: agent, new worktree or current one, editable prompt, branch template |
| Linear Issues | [BautistaPessagno/orca-linear](https://github.com/BautistaPessagno/orca-linear) | Grouping by status, current cycle, status bar count |
| Azure DevOps | [kloppers-labs/orca-azure-devops](https://github.com/kloppers-labs/orca-azure-devops) | Widest use of contribution points |
| OpenProject MCP | [IvanHa-dev/mcp-openproject](https://github.com/IvanHa-dev/mcp-openproject) | Panel + MCP with guarded writes |
| Beads Board | [Roflochinsky/beads-orca](https://github.com/Roflochinsky/beads-orca) | Most starred task plugin (30 stars): board UX |

## Native Plane PRs in stablyai/orca: what to port

| PR | Head sha | Take |
|---|---|---|
| [#29182](https://github.com/stablyai/orca/pull/29182) pedrogiru | `b86a6e39` | Client core: `src/shared/plane-url.ts`, `plane-ids.ts`; `src/main/plane/plane-http.ts`, `plane-rate-limit.ts`, `plane-pagination.ts`, `plane-api-error.ts`, `plane-api-flavor.ts`, `plane-work-item-mapping.ts`, `plane-comment-html.ts`, `plane-project-metadata.ts`; agent context `src/renderer/src/lib/plane-work-item-linked-context.ts`; filters `.../task-page/plane/plane-work-item-filters.ts` |
| [#15329](https://github.com/stablyai/orca/pull/15329) dragosboca | `582cc58` | Hardening: `src/main/plane/authenticated-request.ts`, `request-rate-limit.ts`, `request-queue.ts`, `cursor-pagination.ts`, `workspace-identity.ts`, `description-markdown.ts`, `shared/plane-work-item-url.ts`; tested on real self-hosted |
| [#14692](https://github.com/stablyai/orca/pull/14692) ugoenyioha | `54e8201` | OAuth (`src/main/plane/oauth.ts`), cycles, modules, links, attachments, server-side filters (`issue-query.ts`) |
| [#20413](https://github.com/stablyai/orca/pull/20413) eojonathan | `046a0985` | Agent guide `skill-guides/orca-plane.md` and CLI command set `src/cli/specs/plane.ts` only; its HTTP layer has bugs |

Before copying code, check that Orca's license allows reuse under ours.

## Plane API facts

Checked against [developers.plane.so](https://developers.plane.so/api-reference/introduction) (docs):
- Base `https://api.plane.so/api/v1/` (Cloud). Self-hosted uses `<server>/api/v1/`.
- Auth `X-API-Key: <token>` (PAT; Plane token values start with "plane_api" and an underscore); OAuth uses `Authorization: Bearer`.
- 60 requests/min per key. The headers `X-RateLimit-Remaining` and `X-RateLimit-Reset` (epoch seconds) report the budget.
- Cursor pagination, cursor `per_page:page:is_prev`, `per_page` max 100. Responses are `{results, next_cursor, next_page_results}`.
- Routes are `/work-items/`. Old servers only have `/issues/`, so probe `work-items` and fall back (#29182).
- No endpoint lists workspaces for a token: the user enters the slug, and the connection check is `projects/?per_page=1`.

From PR code, not confirmed in docs:
- `GET workspaces/{slug}/work-items/PROJ-123/` looks a work item up by key.
- `GET workspaces/{slug}/work-items/search/?search=&workspace_search=` searches.

Endpoints: `users/me/`, `workspaces/{s}/projects/`, `.../projects/{p}/states|labels|cycles|modules/`, `workspaces/{s}/members/`, `.../work-items/` (list, create), `.../work-items/{id}/` (get, PATCH), `.../work-items/{id}/comments/` (`{comment_html}`), `.../links/`.

Use `expand=state,assignees,labels`. Some servers ignore it and return bare ids, so map both forms and fetch states and members when needed (cache about 10 min).

Data model:
- State groups: `backlog|unstarted|started|completed|cancelled`. "Open" means the first three.
- Priority: `urgent|high|medium|low|none`.
- Key: `project.identifier` + `-` + `sequence_id`.
- Label and assignee arrays replace the whole set on PATCH.
- To move an item to a state group, use that group's `default` state.

Hardening to keep:
- `redirect: 'error'` on every credentialed request.
- Refuse `http:` except loopback, and refuse URLs that carry a username or password.
- 20–30 s timeout that also covers the body read.
- Retry a 429 once, GET only, honouring `Retry-After`.
- Keep the rate limit budget per token.
- Only a 401 means the token is bad. An HTML 200 means the URL points at the web app, not the API.
- Escape text sent as `comment_html` or `description_html`.
- Treat ticket text as untrusted data in agent prompts.

Work item URLs:
- `/{slug}/projects/{uuid}/(issues|work-items)/{uuid}`
- `?peekIssue=<uuid>`
- `/{slug}/browse/KEY-N/`

Self-hosted `/browse/` links look like Jira links: only claim them for a connected workspace's origin.
