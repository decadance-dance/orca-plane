# Plane for Orca

An [Orca](https://orca.dev) plugin that brings your [Plane](https://plane.so) work items into Orca's sidebar. Not affiliated with Plane.

- **My open items:** the work items assigned to you that are in backlog, unstarted or started, across the workspace. The list says whether it is complete, partial or stale.
- **Item detail:** state, priority, assignees, labels and the description, with a link to open the item in Plane.
- **Start:** creates an Orca workspace named `<KEY-N>-<title>` in a project you pick and starts an agent there. The agent gets the item as context; the ticket text is marked as data, not instructions.
- **Branch named after the item:** the workspace's Git branch is `<KEY-N>-<title>` too, and the agent is asked to put the key in the title of any pull request it opens, so Plane's Git integration links the branch and the pull request to the item.
- **Agent state:** an item you started shows what the agent in its workspace is doing: Working, Needs input or Done.
- **Follow the workspace:** switching to a workspace started from an item shows that item in the panel, even after it left your list.
- **Readiness hints:** the Start confirmation warns when the description is empty or short, has no checklist, or has no code reference or link. The hints are local advice and never block Start.
- **Status bar:** the count of your open items, and how many agents on them wait for you (`12 · 2 waiting`).

It works with Plane Cloud and with self-hosted Plane servers that serve API v2, and needs Orca 1.4.259 or newer. It only reads from Plane; it never changes your work items.

## Connect

1. In Plane, open Profile settings → Personal Access Tokens and create a token **only for this plugin**. Plane allows 60 requests per minute per token, so a token shared with other tools shares that budget.
2. Open the Plane panel in Orca's right sidebar. Enter the server (Plane Cloud, or your server's URL), the workspace slug (the part after the host in Plane's URLs, such as `acme` in `https://app.plane.so/acme/`), and the token.

The token is stored in Orca's encrypted plugin secrets, which are protected by the OS key store. It is sent only to the server you connected to. If Orca reports that no OS key store is available, the plugin refuses to store the token. To switch server, workspace or account, disconnect and connect again.

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
