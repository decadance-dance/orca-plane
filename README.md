# Plane for Orca

An [Orca](https://orca.dev) plugin that brings your [Plane](https://plane.so) work items into Orca's sidebar. Not affiliated with Plane.

- **My open items:** the work items assigned to you that are in backlog, unstarted or started, across the workspace. The list says whether it is complete, partial or stale.
- **Item detail:** state, priority, assignees, labels and the description, with a link to open the item in Plane.
- **Start:** creates an Orca workspace named `<KEY-N>-<title>` in a project you pick and starts an agent there. The agent gets the item as context (title, state, priority, labels, the parent item's title and the description); the ticket text is marked as data, not instructions.
- **Branch named after the item:** Start asks Orca for the Git branch `<KEY-N>-<title>`, the name the confirmation shows, and asks the agent to put the key in the title of any pull request it opens, so Plane's Git integration links the branch and the pull request to the item. If a worktree of the same name is made by hand at the same moment, Orca gives the later one `-2`; an existing branch of that name is reused when no worktree uses it.
- **Later agents know the item:** in a workspace started from an item, a prompt Orca submits to an agent through its prompt hook (an orchestration dispatch, `orca terminal send`) gets one first line `Plane work item <KEY-N>: <URL>` unless it already names the key, and an agent launched there gets `PLANE_ITEM_KEY` and `PLANE_ITEM_URL` in its environment. Only the key and the URL are passed, never ticket text or the token. Limits: the prompt given to `orca agent launch --prompt` does not pass Orca's prompt hook (Orca 1.4.262), so it gets no line, though the agent still gets the variables; a prompt to a terminal Orca has not reported to the plugin yet passes unchanged; and the first agent of a Start gets no variables when Orca launches it before its `workspace.create` call has returned (the Start prompt names the item anyway).
- **Agent state:** an item you started shows what the agent in its workspace is doing: Working, Needs input or Done.
- **Follow the workspace:** switching to a workspace started from an item shows that item in the panel, even after it left your list.
- **Earlier starts:** the item detail lists the last 10 Starts of the item, newest first, with time, agent, project, workspace name and outcome, also after the workspace is removed. The log stays on this computer and is erased when you disconnect.
- **Readiness hints:** the Start confirmation warns when the description is empty or short, has no checklist, or has no code reference or link. The hints are local advice and never block Start.
- **Status bar:** the count of your open items, and how many agents on them wait for you (`12 · 2 waiting`).

It works with Plane Cloud and with self-hosted Plane servers that serve API v2, and needs Orca 1.4.259 or newer. It only reads from Plane; it never changes your work items.

## Connect

1. In Plane, open Profile settings → Personal Access Tokens and create a token **only for this plugin**. Plane allows 60 requests per minute per token, so a token shared with other tools shares that budget.
2. Open the Plane panel in Orca's right sidebar. Enter the server (Plane Cloud, or your server's URL), the workspace slug (the part after the host in Plane's URLs, such as `acme` in `https://app.plane.so/acme/`), and the token.

The token is stored in Orca's encrypted plugin secrets, which are protected by the OS key store. It is sent only to the server you connected to. If Orca reports that no OS key store is available, the plugin refuses to store the token. To switch server, workspace or account, disconnect and connect again.

## Let agents use Plane

This plugin only reads Plane, and its token never reaches an agent. For an agent that should read more of Plane or update it (comment, change the state), use Plane's own MCP server ([Plane docs](https://developers.plane.so/dev-tools/mcp-server)) with its own access, never the plugin's token:

- **Plane Cloud, signed in as you:** add the hosted server and sign in when the agent asks, for example `claude mcp add --transport http plane https://mcp.plane.so/http/mcp` (then `/mcp` in Claude Code), or `codex mcp add plane --url https://mcp.plane.so/http/mcp` and `codex mcp login plane`.
- **With a token:** create a separate personal access token for the agents and use `https://mcp.plane.so/http/api-key/mcp` with the headers `Authorization: Bearer <token>` and `x-workspace-slug: <slug>`.
- **Self-hosted Plane:** run the server locally (`uvx plane-mcp-server stdio`) with `PLANE_API_KEY`, `PLANE_WORKSPACE_SLUG` and `PLANE_BASE_URL` set to your server.

In a workspace started from an item, the agent finds the item in `PLANE_ITEM_KEY`. Ticket text an agent reads through the MCP server is written by whoever edits the ticket: treat it as untrusted data, as the Start prompt does.

## Develop

```sh
orca plugin validate .
orca plugin test .                 # unit, worker and panel tests (Node, orca/testing)
npx tsc -p .                       # type-check against .orca/types (orca plugin types .)
orca plugin dev watch . --check    # load into Orca, reload on save; needs your approval of its access
bin/check                          # what CI runs
```

Behavior is specified in OpenSpec: `openspec/specs/plane-work-items/`; the design notes are in `openspec/changes/archive/`. Project rules are in `AGENTS.md`.

## License

MIT, see `LICENSE`. Some files are adapted from [stablyai/orca](https://github.com/stablyai/orca) (MIT); see `NOTICE`.
