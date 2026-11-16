// The plugin's worker: the only part with network access and the only holder of the token.
// Orca starts it with the plugin (it has a status bar item) and transpiles this file on load.
import type { OrcaWorkerApi } from 'orca/worker'
import { Connections } from './connection'
import { Items } from './items'
import { Starts } from './starts'

// Timers to stop on deactivate; a set, since tests mount the worker more than once per module.
const running = new Set<Items>()

export default function activate(orca: OrcaWorkerApi): void {
  const conns = new Connections(orca)
  const items = new Items(orca, conns)
  const starts = new Starts(orca, conns, items)
  conns.onChange(async () => orca.panels.post('connection.changed', await conns.status()))
  running.add(items)

  // Queued before any request can change a Start state.
  void starts.recover()
  void items.start()

  orca.panels.handle('connection.get', () => conns.status())
  orca.panels.handle('connection.connect', (input) => conns.connect(input))
  orca.panels.handle('connection.disconnect', () => conns.disconnect())
  orca.panels.handle('items.list', (input) => items.list(input?.force === true))
  orca.panels.handle('item.get', ({ key, projectId }) => items.detail(key, projectId))
  orca.panels.handle('starts.get', () => starts.all())
  orca.panels.handle('item.start', (input) => starts.start(input))

  orca.panels.handle('orca.projects', async () => {
    const { projects } = await orca.host.call('project.list')
    return {
      projects: projects
        .filter((project) => project.kind === 'git')
        .map(({ id, name, hostId }) => ({ id, name, hostId }))
    }
  })

  orca.panels.handle('workspace.open', async ({ workspaceId }) => {
    try {
      await orca.host.call('workspace.open', { workspaceId })
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'Could not open the workspace.' }
    }
  })
}

export function deactivate(): void {
  for (const items of running) items.stop()
  running.clear()
}
