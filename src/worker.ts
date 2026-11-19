// The plugin's worker: the only part with network access and the only holder of the token.
// Orca starts it with the plugin (it has a status bar item) and transpiles this file on load.
import type { OrcaWorkerApi } from 'orca/worker'
import { agentFinder } from './agents'
import { Connections } from './connection'
import { Items } from './items'
import { Links } from './links'
import { getItem, getItemByKey } from './plane/api'
import { PlaneError } from './plane/http'
import { type ItemDetail, toDetail } from './plane/map'
import { browseUrl, parseItemRef } from './plane/url'
import type { Result } from './protocol'
import { namesKey, pointer } from './start'
import { Starts } from './starts'

// Timers to stop on deactivate; a set, since tests mount the worker more than once per module.
const running = new Set<Items>()

export default function activate(orca: OrcaWorkerApi): void {
  const conns = new Connections(orca)
  const items = new Items(orca, conns)
  const starts = new Starts(orca, conns, items)
  const links = new Links({
    changed: (all, waiting) => {
      orca.panels.post('links.changed', all)
      void items.showWaiting(waiting)
    },
    focus: (key) => orca.panels.post('focus.changed', { key })
  })
  starts.onWrite((states) => {
    links.set(states)
    void links.seed(orca.host)
  })
  starts.onCreated((key, workspaceId, terminalId) => {
    links.adopt(key, workspaceId, terminalId)
    void links.seed(orca.host)
  })
  conns.onChange(async () => orca.panels.post('connection.changed', await conns.status()))
  // Listeners run inside the connection lock, which a Start read waits for: clear now, rebuild
  // unawaited. The rebuild's write lands only if the connection is still the same (whileCurrent).
  conns.onChange((conn) => {
    links.clear()
    links.connection(conn)
    void starts.all()
  })
  const generation = conns.generation
  void conns.current().then((conn) => {
    if (generation === conns.generation) links.connection(conn)
  })
  running.add(items)

  // Queued before any request can change a Start state; its write also builds the links.
  void starts.recover()
  void items.start()

  const subscribe = (start: () => unknown) => {
    try {
      start()
    } catch {
      // limit: an event whose capability is not approved (`agent:read`) stays off; the rest works as before.
    }
  }
  subscribe(() => orca.events.on('agent.status.changed', (event) => links.agent(event)))
  subscribe(() => orca.events.on('workspace.changed', (event) => links.focus(event)))
  subscribe(() => orca.events.on('workspace.created', (event) => links.created(event)))
  subscribe(() =>
    orca.events.on('workspace.removed', async (event) => {
      // Also when Links does not know the link yet (a rebuild in flight): the event names the workspace,
      // and Links adds the stable id when the event names only the other form.
      await starts.dropWorkspace(links.removed(event))
    })
  )

  // A Start's own create gets the item's branch; every other create passes unchanged (design B1).
  orca.hooks.on('workspace.create.before', (event, next) => {
    const branch = event.kind === 'worktree' ? starts.branchFor(event.projectId, event.name) : undefined
    return next(branch ? { ...event, branch } : event)
  })

  // agent-item-context A1, A2: from memory only; a throw or timeout passes the prompt or launch unchanged.
  orca.hooks.on('agent.prompt.before', (event, next) => {
    const item = links.itemOfTerminal(event.terminalId)
    return next(item && !namesKey(event.prompt, item.key) ? { ...event, prompt: `${pointer(item.key, item.url)}\n${event.prompt}` } : event)
  })
  // The key and URL only: the token never leaves the worker.
  orca.hooks.on('agent.launch.before', (event, next) => {
    const item = links.launch(event)
    return next(item ? { ...event, env: { ...event.env, PLANE_ITEM_KEY: item.key, PLANE_ITEM_URL: item.url } } : event)
  })

  orca.panels.handle('connection.get', () => conns.status())
  orca.panels.handle('connection.connect', (input) => conns.connect(input))
  orca.panels.handle('connection.disconnect', () => conns.disconnect())
  orca.panels.handle('items.list', (input) => items.list(input?.force === true))
  orca.panels.handle('item.get', ({ key, projectId }) => items.detail(key, projectId))
  orca.panels.handle('item.lookup', ({ text }) => lookup(conns, text))
  orca.panels.handle('starts.get', () => starts.get())
  orca.panels.handle('start.hide', async ({ key }) => {
    await starts.hide(key)
    return { ok: true as const }
  })
  orca.panels.handle('history.get', ({ key }) => starts.history(key))
  orca.panels.handle('links.get', () => links.byKey())
  orca.panels.handle('item.start', (input) => starts.start(input))

  const installedAgents = agentFinder()
  orca.panels.handle('agents.installed', async () => ({ agents: await installedAgents() }))

  orca.panels.handle('orca.projects', async () => {
    const { projects } = await orca.host.call('project.list')
    return {
      projects: projects
        .filter((project) => project.kind === 'git')
        .map(({ id, name, hostId }) => ({ id, name, hostId }))
    }
  })

  const openWorkspace = async (workspaceId: string): Promise<Result<{}>> => {
    try {
      await orca.host.call('workspace.open', { workspaceId })
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'Could not open the workspace.' }
    }
  }
  orca.panels.handle('workspace.open', ({ workspaceId }) => openWorkspace(workspaceId))

  // Palette commands (design K4 of keyboard-commands): each returns what it has to say, or nothing.
  const run = async (workspaceId: string) => {
    const opened = await openWorkspace(workspaceId)
    return opened.ok ? undefined : opened.error
  }
  const command = (id: string, handler: () => string | undefined | Promise<string | undefined>) =>
    orca.commands.register(id, async () => {
      const said = await handler()
      // limit: Orca 1.4.262 drops a command's return value when a shortcut or the palette runs it,
      // so the message also goes out as a notification; the returned string stays for callers that show it.
      if (said) {
        try {
          await orca.host.call('notifications.show', { title: 'Plane', body: said })
        } catch {
          // A refused notification still leaves the returned message.
        }
      }
      return said
    })
  // In memory only: the last panel to open or close a detail wins.
  let shown: string | null = null
  orca.panels.handle('panel.shown', ({ key }) => {
    shown = key
    return { ok: true as const }
  })
  command('plane.nextWaiting', () => {
    const first = links.waiting()[0]
    return first ? run(first.workspaceId) : 'No agent on a Plane item waits for you.'
  })
  command('plane.openShown', () => {
    if (!shown) return 'The panel shows no item.'
    const link = links.byKey()[shown]
    return link ? run(link.workspaceId) : `${shown} has no workspace.`
  })
  command('plane.refresh', async () => {
    if (!(await conns.current())) return 'Not connected to Plane.'
    void items.refresh()
    return undefined
  })
}

/** An item by a typed key or a pasted URL, listed or not (keyboard-commands K1, K2); nothing is cached (K3). */
async function lookup(conns: Connections, text: string): Promise<Result<{ item: ItemDetail }>> {
  const generation = conns.generation
  const conn = await conns.current()
  if (!conn) return { ok: false, error: 'Not connected to Plane.' }
  const ref = parseItemRef(text, conn)
  if ('reason' in ref) return { ok: false, error: ref.reason }
  try {
    const raw =
      'key' in ref
        ? await getItemByKey(conn, conn.slug, ref.key, conns.signal)
        : await getItem(conn, conn.slug, ref.projectId, ref.id, conns.signal)
    // A disconnect or account switch during the read: the item belongs to the former connection.
    if (generation !== conns.generation) return { ok: false, error: 'Not connected to Plane.' }
    const item = toDetail(raw, (key) => browseUrl(conn.appBase, conn.slug, key))
    return item ? { ok: true, item } : { ok: false, error: 'Plane sent an unreadable item.' }
  } catch (error) {
    if (error instanceof PlaneError && error.kind === 'not_found') {
      return { ok: false, error: 'key' in ref ? `No item has the key ${ref.key}.` : 'No item was found at that URL.' }
    }
    return { ok: false, error: error instanceof PlaneError ? error.message : 'Could not load the item.' }
  }
}

export function deactivate(): void {
  for (const items of running) items.stop()
  running.clear()
}
