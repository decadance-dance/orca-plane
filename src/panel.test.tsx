// The panel over a mock host whose `requests` stand in for src/worker.ts.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { Item, ItemDetail } from './plane/map'
import * as panel from './panel'
import type { ConnectInput, ItemsState, StartState } from './protocol'

/** Callouts and list items read as their title plus their text, so match a part. */
const part = (text: string) => ({ text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })

const CONNECTED = { connected: true as const, hostKind: 'cloud' as const, server: 'https://app.plane.so', slug: 'truelogic', userName: 'Dima' }

const STATE_NAMES = { started: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', unknown: null }

const item = (key: string, stateGroup: Item['stateGroup'], title = `Title ${key}`, labels: string[] = []): Item => ({
  id: key,
  key,
  title,
  // One Plane project per key prefix, as in Plane.
  projectId: `project-${key.split('-')[0]}`,
  stateName: STATE_NAMES[stateGroup],
  stateGroup,
  priority: 'high',
  labels,
  updatedAt: '2026-11-16T18:20:38Z'
})

const list = (over: Partial<ItemsState> = {}): ItemsState => ({
  items: [item('WEB-1', 'started'), item('WEB-2', 'unstarted', 'Title WEB-2', ['auth']), item('WEB-3', 'unstarted')],
  completeness: 'complete',
  fetchedAt: 1_700_000_000_000,
  error: null,
  refreshing: false,
  ...over
})

const DETAIL: ItemDetail = {
  ...item('WEB-1', 'started', 'Fix login'),
  assignees: ['Dima'],
  labels: ['bug'],
  description: 'First paragraph.\n\n- one\n- two',
  url: 'https://app.plane.so/truelogic/browse/WEB-1/'
}

function connectedHost(extra: Record<string, unknown> = {}, starts: Record<string, StartState> = {}, settings: Record<string, string> = {}) {
  return mockHost({
    settings,
    requests: {
      'connection.get': CONNECTED,
      'items.list': list(),
      'starts.get': starts,
      'item.get': { ok: true, item: DETAIL },
      'orca.projects': { projects: [{ id: 'p1', name: 'repo', hostId: 'local' }] },
      'agents.installed': { agents: [{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }] },
      ...extra
    }
  })
}

// --- 6.1 Connect ---

test('connect submits the form, clears the token field and shows the list', async () => {
  const sent: ConnectInput[] = []
  let connected = false
  const host = mockHost({
    requests: {
      'connection.get': { connected: false },
      'connection.connect': (input) => {
        sent.push(input)
        connected = true
        return { ok: true, status: CONNECTED }
      },
      'items.list': () => list(),
      'starts.get': {}
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Connect to Plane' }))
  await view.type({ label: 'Workspace slug' }, 'truelogic')
  await view.type({ label: 'Personal access token' }, 'plane_api_secret')
  await view.press({ text: 'Connect' })
  assert.deepEqual(sent, [{ hostKind: 'cloud', serverUrl: '', slug: 'truelogic', token: 'plane_api_secret' }])
  assert.ok(connected)
  assert.ok(view.find({ text: 'Dima · truelogic' }))
  assert.ok(view.find({ testId: 'WEB-1' }))
  assert.deepEqual(view.errors, [])
  assert.equal(JSON.stringify(view.persisted).includes('plane_api_secret'), false)
  await view.unmount()
})

test('each connect error is shown and the token field is empty again', async () => {
  for (const error of [
    'The token is invalid.',
    'Workspace "nope" was not found.',
    'This server is not supported: it does not serve Plane API v2.',
    'Refused: plain http is allowed only to this machine (localhost). Use https://.',
    'A protected key store is required: Orca reports that secrets cannot be encrypted on this system.'
  ]) {
    const host = mockHost({
      requests: { 'connection.get': { connected: false }, 'connection.connect': { ok: false, error } }
    })
    const view = await mount(panel, { host })
    await view.select({ label: 'Server' }, 'self-hosted')
    await view.type({ label: 'Server URL' }, 'http://plane.example.com')
    await view.type({ label: 'Personal access token' }, 'plane_api_secret')
    await view.press({ text: 'Connect' })
    assert.ok(view.find(part(error)), error)
    assert.equal(view.valueOf({ label: 'Personal access token' }), '')
    await view.unmount()
  }
})

test('disconnect goes back to the connect form', async () => {
  const host = connectedHost({ 'connection.disconnect': { connected: false } })
  const view = await mount(panel, { host })
  await view.press({ text: 'Disconnect' })
  assert.ok(view.find({ text: 'Connect to Plane' }))
  await view.unmount()
})

// --- 6.2 and 6.6 List ---

test('the list after the Agents panel: header, status line, count bar, groups, rows with a meta line and icon actions', async () => {
  const view = await mount(panel, { host: connectedHost() })
  assert.ok(view.find({ text: 'Plane' }))
  assert.ok(view.find({ text: 'Dima · truelogic' }))
  assert.ok(view.find({ type: 'Text', text: '3 items' }))
  assert.ok(view.find({ type: 'Collapsible', label: 'In Progress' }))
  assert.match(view.find({ type: 'Collapsible', label: 'Todo' })?.text ?? '', /2 items/)
  assert.equal(view.find({ type: 'Collapsible', label: 'Backlog' }), null)
  assert.ok(view.find({ type: 'Badge', text: 'Complete' }))
  const row = view.find({ testId: 'WEB-2' })
  assert.match(row?.text ?? '', /Title WEB-2/)
  assert.match(row?.text ?? '', /WEB-2 · Todo · /)
  // Tags: outlined in their tone (the priority) or grey (labels), not filled while inactive.
  const priority = view.find({ testId: 'priority:WEB-2' })
  assert.deepEqual([priority?.text, priority?.props.border, priority?.props.background], ['high', 'accent', 'none'])
  assert.deepEqual(view.findAll({ type: 'Box', text: 'auth' }).map((tag) => [tag.props.border, tag.props.background]), [['neutral', 'none']])
  // The title is text; the icon buttons are named by their tooltips.
  assert.equal(view.find({ type: 'Link' }), null)
  // The row itself opens the item; Start sits beside it, outside the pressable row.
  assert.ok(view.find({ testId: 'WEB-2' })?.props.onPress)
  assert.equal(view.find({ testId: 'open:WEB-2' }), null)
  assert.deepEqual([view.find({ testId: 'start:WEB-2' })?.type, view.find({ testId: 'start:WEB-2' })?.label], ['IconButton', 'Start'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('search filters by key, title or label; nothing matching offers Clear search', async () => {
  const view = await mount(panel, { host: connectedHost() })
  await view.type({ label: 'Search' }, 'AUTH')
  const links = () => view.findAll({ type: 'ListItem' }).map((row) => row.key)
  assert.deepEqual(links(), ['WEB-2'])
  await view.type({ label: 'Search' }, 'web-3', { replace: true })
  assert.deepEqual(links(), ['WEB-3'])
  await view.type({ label: 'Search' }, 'title web-1', { replace: true })
  assert.deepEqual(links(), ['WEB-1'])
  await view.type({ label: 'Search' }, 'zzz', { replace: true })
  assert.ok(view.find({ label: 'No matching items' }))
  // The badge describes the whole list, not the filtered one.
  assert.ok(view.find({ type: 'Badge', text: 'Complete' }))
  await view.press({ text: 'Clear search' })
  assert.equal(view.findAll({ type: 'ListItem' }).length, 3)
  await view.unmount()
})

// --- 6.13 One tab per Plane project ---

const twoProjects = () =>
  list({
    items: [
      item('WEB-1', 'started'),
      item('API-7', 'unstarted', 'Title API-7', ['auth']),
      item('WEB-2', 'unstarted', 'Title WEB-2', ['auth']),
      item('API-8', 'backlog')
    ]
  })
type Finder = { findAll: (query: { type: string }) => { key?: string; text: string; props: Readonly<Record<string, unknown>> }[] }
const rows = (view: Finder) => view.findAll({ type: 'ListItem' }).map((row) => row.key)
const switcher = (view: Finder) => view.findAll({ type: 'Button' }).filter((button) => button.key?.startsWith('tab:'))
const tabLabels = (view: Finder) => switcher(view).map((button) => button.text)
/** The selected tab is the outlined one. */
const selectedTab = (view: Finder) => switcher(view).find((button) => button.props.variant === 'outline')?.key

test('one tab per project, named by key prefix and ordered; state groups inside the selected tab', async () => {
  const view = await mount(panel, { host: connectedHost({ 'items.list': twoProjects() }) })
  assert.deepEqual(tabLabels(view), ['API 2', 'WEB 2'])
  assert.equal(selectedTab(view), 'tab:project-API')
  assert.deepEqual(rows(view), ['API-7', 'API-8'])
  assert.ok(view.find({ type: 'Text', text: '2 items' }))
  assert.ok(view.find({ type: 'Collapsible', label: 'Todo' }))
  assert.ok(view.find({ type: 'Collapsible', label: 'Backlog' }))
  assert.equal(view.find({ type: 'Collapsible', label: 'In Progress' }), null)
  await view.press({ testId: 'tab:project-WEB' })
  assert.equal(selectedTab(view), 'tab:project-WEB')
  assert.deepEqual(rows(view), ['WEB-1', 'WEB-2'])
  assert.ok(view.find({ type: 'Collapsible', label: 'In Progress' }))
  assert.equal(view.persisted.plugin['plane.tab'], 'project-WEB')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a project whose items carry different key prefixes is named by its newest item', async () => {
  // The list is newest first.
  const items = [item('WEB-2', 'started'), { ...item('OLD-1', 'backlog'), projectId: 'project-WEB' }]
  const view = await mount(panel, { host: connectedHost({ 'items.list': list({ items }) }) })
  assert.deepEqual(tabLabels(view), ['WEB 2'])
  await view.unmount()
})

test('priority pills: urgent danger, high accent, medium warning, low accent (Orca draws a success border at 25%), none without a pill', async () => {
  const at = (key: string, priority: Item['priority']): Item => ({ ...item(key, 'started'), priority })
  const items = [at('WEB-1', 'urgent'), at('WEB-2', 'high'), at('WEB-3', 'medium'), at('WEB-4', 'low'), at('WEB-5', 'none')]
  const view = await mount(panel, { host: connectedHost({ 'items.list': list({ items }) }) })
  const tone = (key: string) => view.find({ testId: `priority:${key}` })?.props.border ?? null
  assert.deepEqual(['WEB-1', 'WEB-2', 'WEB-3', 'WEB-4', 'WEB-5'].map(tone), ['danger', 'accent', 'warning', 'accent', null])
  await view.unmount()
})

// --- 6.16 Tag filters ---

const tagged = () =>
  list({
    items: [
      { ...item('WEB-1', 'started', 'Title WEB-1', ['dst', 'deploy']), priority: 'high' },
      { ...item('WEB-2', 'started', 'Title WEB-2', ['dst']), priority: 'medium' },
      { ...item('API-3', 'started', 'Title API-3', ['deploy']), priority: 'high' }
    ]
  })

test('tags filter the list: every active tag must match, in every project; an active tag is solid and a second press drops it', async () => {
  const view = await mount(panel, { host: connectedHost({ 'items.list': tagged() }) })
  const tag = (text: string) => view.findAll({ type: 'Button', text })[0]
  const fill = (text: string) => view.findAll({ type: 'Box', text }).find((box) => box.props.border)?.props.background
  await view.press(tag('deploy'))
  assert.deepEqual(tabLabels(view), ['API 1', 'WEB 1'])
  assert.equal(fill('deploy'), 'muted')
  await view.press({ testId: 'tab:project-WEB' })
  assert.deepEqual(rows(view), ['WEB-1'])
  await view.press(tag('dst'))
  assert.deepEqual(tabLabels(view), ['API 0', 'WEB 1'])
  // Pressing the active tag again drops it: every dst item shows again.
  await view.press(tag('deploy'))
  assert.deepEqual(rows(view), ['WEB-1', 'WEB-2'])
  assert.equal(fill('deploy'), 'none')
  await view.press(tag('high'))
  assert.deepEqual(rows(view), ['WEB-1'])
  assert.deepEqual([view.find({ testId: 'priority:WEB-1' })?.props.border, view.find({ testId: 'priority:WEB-1' })?.props.background], ['accent', 'accent'])
  assert.deepEqual(view.persisted.plugin['plane.tags'], ['label:dst', 'priority:high'])
  // The badge describes the whole list.
  assert.ok(view.find({ type: 'Badge', text: 'Complete' }))
  await view.type({ label: 'Search' }, 'zzz')
  await view.press({ text: 'Clear search' })
  assert.deepEqual(view.persisted.plugin['plane.tags'], [])
  assert.deepEqual(rows(view), ['WEB-1', 'WEB-2'])
  await view.unmount()
})

test('the active tags are remembered', async () => {
  const view = await mount(panel, {
    host: connectedHost({ 'items.list': tagged() }),
    persisted: { plugin: { 'plane.tags': ['label:deploy'] } }
  })
  assert.deepEqual(tabLabels(view), ['API 1', 'WEB 1'])
  assert.deepEqual(rows(view), ['API-3'])
  await view.unmount()
})

// --- 6.15 Groups by state ---

test('a tab groups by state: by Plane group, then item count, then name; an unknown state last; search keeps the order', async () => {
  const at = (key: string, group: Item['stateGroup'], stateName: string | null): Item => ({ ...item(key, group), stateName })
  const items = [
    at('WEB-1', 'started', 'In Review'),
    at('WEB-2', 'started', 'Blocked'),
    at('WEB-3', 'unstarted', 'Todo'),
    at('WEB-4', 'started', 'In Progress'),
    at('WEB-5', 'started', 'Blocked'),
    at('WEB-6', 'unknown', null),
    at('WEB-7', 'started', 'In Progress'),
    at('WEB-8', 'started', 'Ready'),
    at('WEB-9', 'backlog', 'Backlog')
  ]
  const view = await mount(panel, { host: connectedHost({ 'items.list': list({ items }) }) })
  const groups = () => view.findAll({ type: 'Collapsible' }).map((group) => `${group.label} ${group.props.description}`)
  // Blocked and In Progress tie on count, so their names order them; In Review and Ready likewise.
  assert.deepEqual(groups(), ['Blocked 2 items', 'In Progress 2 items', 'In Review 1 item', 'Ready 1 item', 'Todo 1 item', 'Backlog 1 item', 'Unknown state 1 item'])
  await view.type({ label: 'Search' }, 'web-5')
  assert.deepEqual(groups(), ['Blocked 1 item'])
  assert.deepEqual(view.findAll({ type: 'ListItem' }).map((row) => row.key), ['WEB-5'])
  await view.unmount()
})

test('the remembered tab is selected again; a project with no items falls back to the first tab', async () => {
  const again = await mount(panel, {
    host: connectedHost({ 'items.list': twoProjects() }),
    persisted: { plugin: { 'plane.tab': 'project-WEB' } }
  })
  assert.equal(selectedTab(again), 'tab:project-WEB')
  assert.deepEqual(rows(again), ['WEB-1', 'WEB-2'])
  await again.unmount()
  const gone = await mount(panel, {
    host: connectedHost({ 'items.list': twoProjects() }),
    persisted: { plugin: { 'plane.tab': 'project-OPS' } }
  })
  assert.equal(selectedTab(gone), 'tab:project-API')
  assert.deepEqual(rows(gone), ['API-7', 'API-8'])
  await gone.unmount()
})

test('search spans every project: tab labels count the matches; an empty tab offers Clear search', async () => {
  const view = await mount(panel, { host: connectedHost({ 'items.list': twoProjects() }) })
  await view.type({ label: 'Search' }, 'web-1')
  assert.deepEqual(tabLabels(view), ['API 0', 'WEB 1'])
  assert.ok(view.find({ label: 'No matching items' }))
  await view.press({ testId: 'tab:project-WEB' })
  assert.deepEqual(rows(view), ['WEB-1'])
  await view.type({ label: 'Search' }, 'auth', { replace: true })
  assert.deepEqual(tabLabels(view), ['API 1', 'WEB 1'])
  assert.deepEqual(rows(view), ['WEB-2'])
  await view.type({ label: 'Search' }, 'zzz', { replace: true })
  await view.press({ text: 'Clear search' })
  assert.deepEqual(tabLabels(view), ['API 2', 'WEB 2'])
  await view.unmount()
})

test('partial, stale, error, empty and loading states', async () => {
  const cases: [Partial<ItemsState>, string][] = [
    [{ completeness: 'partial', error: 'More than 1000 items' }, 'Partial'],
    [{ completeness: 'stale', error: 'Plane answered HTTP 500' }, 'Stale'],
    [{ completeness: 'error', items: [], fetchedAt: null, error: 'Could not reach the Plane server.' }, 'Error']
  ]
  for (const [over, badge] of cases) {
    const view = await mount(panel, { host: connectedHost({ 'items.list': list(over) }) })
    assert.ok(view.find({ type: 'Badge', text: badge }), badge)
    assert.ok(view.find(part(over.error ?? '')), badge)
    await view.unmount()
  }
  const empty = await mount(panel, { host: connectedHost({ 'items.list': list({ items: [] }) }) })
  assert.ok(empty.find({ label: 'Nothing open is assigned to you' }))
  await empty.unmount()
  const loading = await mount(panel, { host: connectedHost({ 'items.list': list({ items: [], completeness: null, refreshing: true }) }) })
  assert.ok(loading.find({ type: 'Skeleton' }))
  await loading.unmount()
})

test('refresh asks for a forced refresh; posts update the list and each row follows its Start state', async () => {
  const asked: unknown[] = []
  const view = await mount(panel, {
    host: connectedHost({
      'items.list': (input: unknown) => {
        asked.push(input ?? null)
        return list()
      }
    })
  })
  await view.press({ label: 'Refresh' })
  assert.deepEqual(asked.at(-1), { force: true })
  await view.post('items.changed', list({ items: [item('WEB-9', 'backlog')] }))
  assert.ok(view.find({ type: 'Collapsible', label: 'Backlog' }))
  const button = () => view.find({ testId: 'start:WEB-9' })
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'pending', name: 'n', projectId: 'p1', startedAt: 1 } })
  assert.deepEqual([button()?.label, button()?.disabled], ['Starting…', true])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'unknown', name: 'n', projectId: 'p1' } })
  assert.deepEqual([button()?.label, button()?.disabled], ['Checking…', true])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'failed', error: 'refused' } })
  assert.ok(view.find({ type: 'Badge', text: 'Start failed' }))
  assert.equal(button()?.label, 'Start')
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'created', workspaceId: 'w', name: 'n', projectId: 'p1' } })
  assert.equal(button()?.label, 'Open workspace')
  await view.unmount()
})

// --- 6.3 and 6.7 Detail and Start ---

test('Start on a row asks for the project, an installed agent and the editable prompt, then starts with them', async () => {
  const started: unknown[] = []
  const host = connectedHost({
    'item.start': (input: unknown) => {
      started.push(input)
      return { accepted: true }
    }
  })
  const view = await mount(panel, { host })
  // The pickers belong to the confirmation, not to the list.
  assert.equal(view.find({ label: 'Project' }), null)
  assert.equal(view.find({ label: 'Agent' }), null)
  await view.press({ testId: 'start:WEB-1' })
  assert.match(view.find({ type: 'Card', label: 'Start WEB-1' })?.text ?? '', /WEB-1-fix-login/)
  assert.equal(view.valueOf({ label: 'Project' }), 'p1')
  const options = view.find({ label: 'Agent' })?.props.options as { value: string }[]
  assert.deepEqual(options.map((option) => option.value), ['claude', 'codex', 'none'])
  await view.select({ label: 'Agent' }, 'none')
  assert.match(String(view.valueOf({ label: 'Prompt' })), /BEGIN PLANE TICKET/)
  await view.type({ label: 'Prompt' }, 'Do it', { replace: true })
  await view.press({ text: 'Confirm' })
  assert.deepEqual(started, [{ key: 'WEB-1', orcaProjectId: 'p1', hostId: 'local', agent: null, prompt: 'Do it' }])
  assert.equal(view.find({ type: 'Card', label: 'Start WEB-1' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Cancel creates nothing; a refused start shows its reason in the confirmation', async () => {
  let starts = 0
  const host = connectedHost({
    'item.start': () => {
      starts++
      return { accepted: false, reason: 'A start for this item is already running.' }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ testId: 'start:WEB-2' })
  assert.ok(view.find({ type: 'Card', label: 'Start WEB-2' }))
  await view.press({ text: 'Cancel' })
  assert.equal(view.find({ type: 'Card', label: 'Start WEB-2' }), null)
  assert.equal(starts, 0)
  await view.press({ testId: 'start:WEB-2' })
  await view.press({ text: 'Confirm' })
  assert.equal(starts, 1)
  assert.ok(view.find(part('A start for this item is already running.')))
  await view.unmount()
})

test('Open shows the detail: fields, Markdown description, Open in Plane, the same Start confirmation, and back', async () => {
  const opened: unknown[] = []
  const host = connectedHost({
    'item.start': { accepted: true },
    'workspace.open': (input: unknown) => {
      opened.push(input)
      return { ok: true }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ testId: 'WEB-1' })
  assert.ok(view.find({ text: 'WEB-1 Fix login' }))
  assert.equal(view.find({ type: 'Markdown' })?.props.content, DETAIL.description)
  assert.match(view.find({ type: 'KeyValue' })?.text ?? '', /bug/)
  await view.press({ text: 'Open in Plane' })
  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: DETAIL.url }])
  await view.press({ testId: 'start:WEB-1' })
  assert.ok(view.find({ type: 'Card', label: 'Start WEB-1' }))
  await view.press({ text: 'Confirm' })
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'failed', error: 'agent crashed', workspaceId: 'w5' } })
  assert.ok(view.find(part('agent crashed')))
  await view.press({ testId: 'start:WEB-1' })
  assert.deepEqual(opened, [{ workspaceId: 'w5' }])
  await view.press({ text: '← All items' })
  assert.ok(view.find({ type: 'Collapsible', label: 'Todo' }))
  await view.unmount()
})

test('going back to the list closes a Start confirmation opened in the detail', async () => {
  const view = await mount(panel, { host: connectedHost() })
  await view.press({ testId: 'WEB-1' })
  await view.press({ testId: 'start:WEB-1' })
  assert.ok(view.find({ type: 'Card', label: 'Start WEB-1' }))
  await view.press({ text: '← All items' })
  assert.equal(view.find({ type: 'Card', label: 'Start WEB-1' }), null)
  assert.equal(view.persisted.plugin['plane.confirm'], null)
  assert.equal(view.find({ testId: 'start:WEB-1' })?.disabled, false)
  await view.unmount()
})

test('no Git projects: the confirmation shows a hint instead of the project picker, and Confirm is disabled', async () => {
  const view = await mount(panel, { host: connectedHost({ 'orca.projects': { projects: [] } }) })
  await view.press({ testId: 'start:WEB-1' })
  assert.ok(view.find(part('No Git projects')))
  assert.equal(view.find({ label: 'Project' }), null)
  assert.equal(view.find({ text: 'Confirm' })?.disabled, true)
  await view.unmount()
})

test('the preselected agent: the remembered one if installed, else defaultAgent if installed, else the first', async () => {
  const cases: [Record<string, string>, Record<string, string>, string][] = [
    [{ 'plane.agent': 'codex' }, {}, 'codex'],
    [{ 'plane.agent': 'gemini' }, { defaultAgent: 'codex' }, 'codex'],
    [{}, { defaultAgent: 'gemini' }, 'claude']
  ]
  for (const [persisted, settings, expected] of cases) {
    const host = connectedHost({}, {}, settings)
    const view = await mount(panel, { host, persisted: { plugin: persisted } })
    await view.press({ testId: 'start:WEB-1' })
    assert.equal(view.valueOf({ label: 'Agent' }), expected, JSON.stringify([persisted, settings]))
    await view.unmount()
  }
})

test('a worker that does not answer shows the error and Retry loads again', async () => {
  let calls = 0
  const host = mockHost({
    requests: {
      'connection.get': () => {
        if (calls++ === 0) throw new Error('worker unavailable')
        return { connected: false }
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find(part('worker unavailable')))
  await view.press({ text: 'Retry' })
  assert.ok(view.find({ text: 'Connect to Plane' }))
  await view.unmount()
})
