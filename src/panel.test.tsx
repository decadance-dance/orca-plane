// The panel over a mock host whose `requests` stand in for src/worker.ts.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { Item, ItemDetail } from './plane/map'
import { browseUrl, parseItemRef } from './plane/url'
import * as panel from './panel'
import { buildPrompt } from './start'
import type { Attempt, ConnectInput, ItemsState, StartState } from './protocol'

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
      'starts.get': { states: starts, hidden: [] },
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
      'starts.get': { states: {}, hidden: [] }
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
  await view.press({ label: 'Show actions' })
  await view.press({ text: 'Disconnect' })
  assert.ok(view.find({ text: 'Connect to Plane' }))
  await view.unmount()
})

// --- 6.2 and 6.6 List (layout: compact-panel-layout P1-P8) ---

type Finder = {
  find: (query: { type?: string; testId?: string; label?: string; text?: string }) => { text: string; props: Readonly<Record<string, unknown>> } | null
  findAll: (query: { type: string; text?: string }) => { key?: string; text: string; label?: string; props: Readonly<Record<string, unknown>> }[]
}
/** The open detail when it shows `key` titled `title`, else null: its framed header names both. */
const detailOf = (view: Finder, key: string, title: string) => {
  const header = view.find({ testId: 'detail-header' })
  return header && view.find({ type: 'Text', text: key }) && view.find({ type: 'Heading', text: title }) ? header : null
}

/** Types into Open by key or URL, behind the header's ⋯, opening it first when it is hidden. */
async function typeLookup(view: Awaited<ReturnType<typeof mount>>, text: string, options?: { submit?: boolean; replace?: boolean }) {
  if (!view.find({ label: 'Open by key or URL' })) await view.press({ label: 'Show actions' })
  await view.type({ label: 'Open by key or URL' }, text, options)
}
const rows = (view: Finder) => view.findAll({ type: 'ListItem' }).map((row) => row.key)
/** The project picker's option labels and its selected project. */
const projectOptions = (view: Finder) => ((view.find({ label: 'Plane project' })?.props.options ?? []) as { label: string }[]).map((option) => option.label)
const selectedProject = (view: Finder) => view.find({ label: 'Plane project' })?.props.value
/** Each group header as `<state> <count>`. */
const groups = (view: Finder) =>
  view
    .findAll({ type: 'Box' })
    .flatMap((box) => (box.key?.startsWith('group:') ? [box.key.slice('group:'.length)] : []))
    .map((name) => `${name} ${view.find({ testId: `count:${name}` })?.text}`)
/** A tag of the filter strip, its box's fill and whether it is checked. */
const tagButton = (view: Finder, text: string) => view.findAll({ type: 'Button', text })[0]
const fill = (view: Finder, text: string) => view.findAll({ type: 'Box', text }).find((box) => box.props.border)?.props.background
const checked = (view: Finder, text: string) => tagButton(view, text)?.props.icon === 'check'

test('the list: header icons, status line, project picker, plain group headers, one-line rows with an icon action', async () => {
  const view = await mount(panel, { host: connectedHost() })
  assert.ok(view.find({ text: 'Plane' }))
  assert.ok(view.find({ text: 'Dima · truelogic' }))
  const icons = view.findAll({ type: 'IconButton' }).filter((button) => !button.key?.startsWith('start:'))
  assert.deepEqual(icons.map((button) => button.label), ['Show search', 'Show filters', 'Refresh', 'Show actions'])
  // Search, the tags, Open by key and Disconnect stay out of the way until asked for.
  assert.equal(view.find({ label: 'Search' }), null)
  assert.equal(view.find({ type: 'Button', text: 'auth' }), null)
  assert.equal(view.find({ label: 'Open by key or URL' }), null)
  assert.equal(view.find({ text: 'Disconnect' }), null)
  // A complete list shows no badge, only its update time, at the bottom.
  assert.equal(view.find({ type: 'Badge' }), null)
  assert.equal(view.find({ testId: 'list-state' }), null)
  assert.match(view.find({ testId: 'list-updated' })?.text ?? '', /^updated /)
  assert.deepEqual(projectOptions(view), ['WEB · 3 items'])
  assert.deepEqual(groups(view), ['In Progress 1', 'Todo 2'])
  // Group names are level-3 headings, which Orca draws small, upper case and muted.
  assert.ok(view.find({ type: 'Heading', text: 'Todo' }))
  assert.equal(view.findAll({ type: 'Separator' }).length, 1)
  assert.equal(view.find({ type: 'Collapsible' }), null)
  // One line: the priority dot in its tone, the key and the title; no labels, state or update time.
  const row = view.find({ testId: 'WEB-2' })
  assert.match(row?.text ?? '', /WEB-2/)
  assert.match(row?.text ?? '', /Title WEB-2/)
  assert.equal(/auth|Todo|ago/.test(row?.text ?? ''), false)
  const dot = view.find({ testId: 'priority:WEB-2' })
  assert.deepEqual([dot?.text, dot?.props.tone], ['●', 'accent'])
  assert.equal(view.find({ type: 'Link' }), null)
  // The row itself opens the item; Start sits beside it, outside the pressable row.
  assert.ok(view.find({ testId: 'WEB-2' })?.props.onPress)
  assert.equal(view.find({ testId: 'open:WEB-2' }), null)
  assert.deepEqual([view.find({ testId: 'start:WEB-2' })?.type, view.find({ testId: 'start:WEB-2' })?.label], ['IconButton', 'Start'])
  // The ⋯ shows Open by key and Disconnect.
  await view.press({ label: 'Show actions' })
  assert.ok(view.find({ label: 'Open by key or URL' }))
  assert.ok(view.find({ type: 'Button', text: 'Disconnect' }))
  // The detail starts with its back control, without the list's header.
  await view.press({ testId: 'WEB-2' })
  assert.deepEqual(view.findAll({ type: 'IconButton' }).map((button) => button.label), [])
  assert.equal(view.find({ text: 'Dima · truelogic' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the Search icon shows and hides the field; the field stays shown while it holds text', async () => {
  const view = await mount(panel, { host: connectedHost() })
  await view.press({ label: 'Show search' })
  assert.ok(view.find({ label: 'Search' }))
  assert.equal(view.find({ label: 'Hide search' })?.props.variant, 'outline')
  await view.press({ label: 'Hide search' })
  assert.equal(view.find({ label: 'Search' }), null)
  await view.press({ label: 'Show search' })
  await view.type({ label: 'Search' }, 'auth')
  // Held by its text: the toggle cannot hide it.
  assert.equal(view.find({ label: 'Hide search' })?.disabled, true)
  await view.type({ label: 'Search' }, '', { replace: true })
  assert.equal(view.find({ label: 'Hide search' })?.disabled, false)
  await view.unmount()
  const remembered = await mount(panel, { host: connectedHost(), persisted: { plugin: { 'plane.search': 'auth' } } })
  assert.equal(remembered.valueOf({ label: 'Search' }), 'auth')
  assert.deepEqual(rows(remembered), ['WEB-2'])
  await remembered.unmount()
})

test('search filters by key, title or label; nothing matching offers Clear search', async () => {
  const view = await mount(panel, { host: connectedHost() })
  await view.press({ label: 'Show search' })
  await view.type({ label: 'Search' }, 'AUTH')
  assert.deepEqual(rows(view), ['WEB-2'])
  await view.type({ label: 'Search' }, 'web-3', { replace: true })
  assert.deepEqual(rows(view), ['WEB-3'])
  await view.type({ label: 'Search' }, 'title web-1', { replace: true })
  assert.deepEqual(rows(view), ['WEB-1'])
  await view.type({ label: 'Search' }, 'zzz', { replace: true })
  assert.ok(view.find({ label: 'No matching items' }))
  // The completeness describes the whole list, not the filtered one.
  assert.equal(view.find({ testId: 'list-state' }), null)
  await view.press({ text: 'Clear search' })
  assert.equal(view.findAll({ type: 'ListItem' }).length, 3)
  await view.unmount()
})

// --- 6.13 Projects ---

const twoProjects = () =>
  list({
    items: [
      item('WEB-1', 'started'),
      item('API-7', 'unstarted', 'Title API-7', ['auth']),
      item('WEB-2', 'unstarted', 'Title WEB-2', ['auth']),
      item('API-8', 'backlog')
    ]
  })

test('one picker entry per project, named by key prefix, ordered and counted; state groups of the selected project', async () => {
  const view = await mount(panel, { host: connectedHost({ 'items.list': twoProjects() }) })
  assert.deepEqual(projectOptions(view), ['API · 2 items', 'WEB · 2 items'])
  assert.equal(selectedProject(view), 'project-API')
  assert.deepEqual(rows(view), ['API-7', 'API-8'])
  assert.deepEqual(groups(view), ['Todo 1', 'Backlog 1'])
  await view.select({ label: 'Plane project' }, 'project-WEB')
  assert.equal(selectedProject(view), 'project-WEB')
  assert.deepEqual(rows(view), ['WEB-1', 'WEB-2'])
  assert.deepEqual(groups(view), ['In Progress 1', 'Todo 1'])
  assert.equal(view.persisted.plugin['plane.tab'], 'project-WEB')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a project whose items carry different key prefixes is named by its newest item', async () => {
  // The list is newest first.
  const items = [item('WEB-2', 'started'), { ...item('OLD-1', 'backlog'), projectId: 'project-WEB' }]
  const view = await mount(panel, { host: connectedHost({ 'items.list': list({ items }) }) })
  assert.deepEqual(projectOptions(view), ['WEB · 2 items'])
  await view.unmount()
})

test('priority dots: urgent danger, high accent, medium warning, low success, none a muted circle', async () => {
  const at = (key: string, priority: Item['priority']): Item => ({ ...item(key, 'started'), priority })
  const items = [at('WEB-1', 'urgent'), at('WEB-2', 'high'), at('WEB-3', 'medium'), at('WEB-4', 'low'), at('WEB-5', 'none')]
  const view = await mount(panel, { host: connectedHost({ 'items.list': list({ items }) }) })
  const dot = (key: string) => {
    const found = view.find({ testId: `priority:${key}` })
    return `${found?.text} ${found?.props.tone ?? (found?.props.muted ? 'muted' : '')}`
  }
  assert.deepEqual(['WEB-1', 'WEB-2', 'WEB-3', 'WEB-4', 'WEB-5'].map(dot), ['● danger', '● accent', '● warning', '● success', '○ muted'])
  // The filter strip offers the priorities in that order, each outlined in its tone; none has no tag.
  await view.press({ label: 'Show filters' })
  const strip = view.findAll({ type: 'Box' }).filter((box) => box.props.radius === 'full')
  assert.deepEqual(strip.map((box) => `${box.text} ${box.props.border}`), ['urgent danger', 'high accent', 'medium warning', 'low success'])
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

test('the filter strip: the priorities and labels of the whole list; every active tag must match, in every project; an active tag is filled and checked, a second press drops it', async () => {
  const view = await mount(panel, { host: connectedHost({ 'items.list': tagged() }) })
  await view.press({ label: 'Show filters' })
  const strip = () => view.findAll({ type: 'Box' }).filter((box) => box.props.radius === 'full').map((box) => box.text)
  // Labels of every project, not only the selected one.
  assert.deepEqual(strip(), ['high', 'medium', 'deploy', 'dst'])
  await view.press(tagButton(view, 'deploy'))
  assert.deepEqual(projectOptions(view), ['API · 1 item', 'WEB · 1 item'])
  // A grey label fills with accent, which a muted fill did not set apart (#64), and shows a check.
  assert.deepEqual([fill(view, 'deploy'), checked(view, 'deploy')], ['accent', true])
  assert.deepEqual([fill(view, 'dst'), checked(view, 'dst')], ['none', false])
  // An active tag holds the strip open.
  assert.equal(view.find({ label: 'Hide filters' })?.disabled, true)
  await view.select({ label: 'Plane project' }, 'project-WEB')
  assert.deepEqual(rows(view), ['WEB-1'])
  await view.press(tagButton(view, 'dst'))
  assert.deepEqual(projectOptions(view), ['API · 0 items', 'WEB · 1 item'])
  // Pressing the active tag again drops it: every dst item shows again.
  await view.press(tagButton(view, 'deploy'))
  assert.deepEqual(rows(view), ['WEB-1', 'WEB-2'])
  assert.deepEqual([fill(view, 'deploy'), checked(view, 'deploy')], ['none', false])
  await view.press(tagButton(view, 'high'))
  assert.deepEqual(rows(view), ['WEB-1'])
  assert.deepEqual([fill(view, 'high'), checked(view, 'high')], ['accent', true])
  assert.deepEqual(view.persisted.plugin['plane.tags'], ['label:dst', 'priority:high'])
  // The completeness describes the whole list.
  assert.equal(view.find({ testId: 'list-state' }), null)
  await view.press({ label: 'Show search' })
  await view.type({ label: 'Search' }, 'zzz')
  // The action names what it clears: the search and the tags.
  await view.press({ text: 'Clear filters' })
  assert.deepEqual(view.persisted.plugin['plane.tags'], [])
  assert.deepEqual(rows(view), ['WEB-1', 'WEB-2'])
  await view.unmount()
})

test('the active tags are remembered and keep the strip shown; a remembered tag no longer in the list can still be turned off', async () => {
  const view = await mount(panel, {
    host: connectedHost({ 'items.list': tagged() }),
    persisted: { plugin: { 'plane.tags': ['label:deploy'] } }
  })
  assert.deepEqual(projectOptions(view), ['API · 1 item', 'WEB · 1 item'])
  assert.deepEqual(rows(view), ['API-3'])
  assert.deepEqual([fill(view, 'deploy'), checked(view, 'deploy')], ['accent', true])
  await view.unmount()
  const gone = await mount(panel, {
    host: connectedHost({ 'items.list': tagged() }),
    persisted: { plugin: { 'plane.tags': ['label:retired'] } }
  })
  assert.ok(gone.find({ label: 'No matching items' }))
  await gone.press(tagButton(gone, 'retired'))
  assert.deepEqual(rows(gone), ['API-3'])
  // Nothing active: the strip hides again, as it was not asked for.
  assert.equal(gone.find({ type: 'Button', text: 'retired' }), null)
  await gone.unmount()
})

// --- 6.15 Groups by state ---

test('a project groups by state under plain headers: by Plane group, then item count, then name; an unknown state last; search keeps the order', async () => {
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
  // Blocked and In Progress tie on count, so their names order them; In Review and Ready likewise.
  assert.deepEqual(groups(view), ['Blocked 2', 'In Progress 2', 'In Review 1', 'Ready 1', 'Todo 1', 'Backlog 1', 'Unknown state 1'])
  assert.equal(view.findAll({ type: 'Separator' }).length, 6)
  await view.press({ label: 'Show search' })
  await view.type({ label: 'Search' }, 'web-5')
  assert.deepEqual(groups(view), ['Blocked 1'])
  assert.equal(view.findAll({ type: 'Separator' }).length, 0)
  assert.deepEqual(rows(view), ['WEB-5'])
  await view.unmount()
})

test('the remembered project is selected again; a project with no items falls back to the first', async () => {
  const again = await mount(panel, {
    host: connectedHost({ 'items.list': twoProjects() }),
    persisted: { plugin: { 'plane.tab': 'project-WEB' } }
  })
  assert.equal(selectedProject(again), 'project-WEB')
  assert.deepEqual(rows(again), ['WEB-1', 'WEB-2'])
  await again.unmount()
  const gone = await mount(panel, {
    host: connectedHost({ 'items.list': twoProjects() }),
    persisted: { plugin: { 'plane.tab': 'project-OPS' } }
  })
  assert.equal(selectedProject(gone), 'project-API')
  assert.deepEqual(rows(gone), ['API-7', 'API-8'])
  await gone.unmount()
})

test('search spans every project: the picker counts the matches; an empty project offers Clear search', async () => {
  const view = await mount(panel, { host: connectedHost({ 'items.list': twoProjects() }) })
  await view.press({ label: 'Show search' })
  await view.type({ label: 'Search' }, 'web-1')
  assert.deepEqual(projectOptions(view), ['API · 0 items', 'WEB · 1 item'])
  assert.ok(view.find({ label: 'No matching items' }))
  await view.select({ label: 'Plane project' }, 'project-WEB')
  assert.deepEqual(rows(view), ['WEB-1'])
  await view.type({ label: 'Search' }, 'auth', { replace: true })
  assert.deepEqual(projectOptions(view), ['API · 1 item', 'WEB · 1 item'])
  assert.deepEqual(rows(view), ['WEB-2'])
  await view.type({ label: 'Search' }, 'zzz', { replace: true })
  await view.press({ text: 'Clear search' })
  assert.deepEqual(projectOptions(view), ['API · 2 items', 'WEB · 2 items'])
  await view.unmount()
})

test('partial, stale, error, empty and loading states: the state is named once, with its reason, in its tone', async () => {
  const cases: [Partial<ItemsState>, string][] = [
    [{ completeness: 'partial', error: 'More than 1000 items' }, 'Partial'],
    [{ completeness: 'stale', error: 'Plane answered HTTP 500' }, 'Stale'],
    [{ completeness: 'error', items: [], fetchedAt: null, error: 'Could not reach the Plane server.' }, 'Error']
  ]
  for (const [over, badge] of cases) {
    const view = await mount(panel, { host: connectedHost({ 'items.list': list(over) }) })
    // No badge and no Callout: Orca titles a Callout even without a title, which named the state twice.
    assert.equal(view.find({ type: 'Badge' }), null, badge)
    assert.equal(view.find({ type: 'Callout' }), null, badge)
    const reason = view.find({ testId: 'list-state' })
    assert.deepEqual([reason?.text, reason?.props.tone], [`${badge} · ${over.error}`, badge === 'Error' ? 'danger' : 'warning'], badge)
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
  assert.deepEqual(groups(view), ['Backlog 1'])
  const button = () => view.find({ testId: 'start:WEB-9' })
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'pending', name: 'n', projectId: 'p1', startedAt: 1 } })
  assert.deepEqual([button()?.label, button()?.disabled], ['Starting…', true])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'unknown', name: 'n', projectId: 'p1' } })
  assert.deepEqual([button()?.label, button()?.disabled], ['Checking…', true])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'failed', error: 'refused' } })
  // A failed Start shows as the row's danger warning icon, which starts again.
  assert.deepEqual([button()?.label, button()?.props.icon, button()?.props.tone], ['Start failed · Start again', 'warning', 'danger'])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'created', workspaceId: 'w', name: 'n', projectId: 'p1' } })
  assert.deepEqual([button()?.label, button()?.props.icon], ['Open workspace', 'open-external'])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'failed', error: 'agent crashed', workspaceId: 'w' } })
  assert.deepEqual([button()?.label, button()?.props.icon], ['Open workspace · The agent did not start', 'warning'])
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
  assert.deepEqual(started, [{ key: 'WEB-1', orcaProjectId: 'p1', hostId: 'local', agent: null, prompt: 'Do it', name: 'WEB-1-fix-login' }])
  assert.equal(view.find({ type: 'Card', label: 'Start WEB-1' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Confirmation shows the branch, named like the workspace, and Start asks for exactly that name', async () => {
  // The list row is titled `Title WEB-1`; the fresh detail says `Fix login`.
  const started: { name?: string }[] = []
  const host = connectedHost({
    'item.start': (input: { name?: string }) => {
      started.push(input)
      return { accepted: true }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ testId: 'start:WEB-1' })
  assert.ok(view.find({ type: 'Text', text: 'Workspace WEB-1-fix-login' }))
  assert.ok(view.find({ type: 'Text', text: 'Branch WEB-1-fix-login' }))
  await view.press({ text: 'Confirm' })
  assert.equal(started[0]?.name, 'WEB-1-fix-login')
  await view.unmount()
})

test('Template with all placeholders: the confirmation prompt is the template filled in, the block in place of {ticket}', async () => {
  const promptTemplate = 'Read AGENTS.md first. Item {key} ({url}).\n{ticket}\nOpen a PR titled with {key}.'
  const host = connectedHost({}, {}, { promptTemplate })
  const view = await mount(panel, { host })
  await view.press({ testId: 'start:WEB-1' })
  assert.equal(view.valueOf({ label: 'Prompt' }), buildPrompt(DETAIL, promptTemplate))
  assert.match(String(view.valueOf({ label: 'Prompt' })), /^Read AGENTS\.md first\. Item WEB-1 \(https:[^)]+\)\.\n----- BEGIN PLANE TICKET/)
  assert.ok(String(view.valueOf({ label: 'Prompt' })).endsWith('----- END PLANE TICKET -----\nOpen a PR titled with WEB-1.'))
  await view.unmount()
})

test('Empty template: the confirmation prompt is the default prompt', async () => {
  for (const settings of [{}, { promptTemplate: '' }]) {
    const view = await mount(panel, { host: connectedHost({}, {}, settings) })
    await view.press({ testId: 'start:WEB-1' })
    assert.equal(view.valueOf({ label: 'Prompt' }), buildPrompt(DETAIL))
    await view.unmount()
  }
})

test('review 1: a changed template applies to the next confirmation without a reload (T4)', async () => {
  const host = connectedHost({}, {}, { promptTemplate: 'First {key} {url}\n{ticket}' })
  const view = await mount(panel, { host })
  await view.press({ testId: 'start:WEB-1' })
  assert.equal(view.valueOf({ label: 'Prompt' }), buildPrompt(DETAIL, 'First {key} {url}\n{ticket}'))
  await view.press({ text: 'Cancel' })
  host.respond('settings.get', { settings: { promptTemplate: 'Second {key} {url}\n{ticket}' } })
  await view.press({ testId: 'start:WEB-1' })
  assert.equal(view.valueOf({ label: 'Prompt' }), buildPrompt(DETAIL, 'Second {key} {url}\n{ticket}'))
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
  assert.ok(detailOf(view, 'WEB-1', 'Fix login'))
  assert.equal(view.find({ type: 'Markdown' })?.props.content, DETAIL.description)
  // The framed header: key and priority badge, the title, then the fields.
  const header = view.find({ testId: 'detail-header' })
  assert.equal(header?.props.background, 'muted')
  // The priority is a pill outlined and written in its tone.
  const pill = view.findAll({ type: 'Box' }).find((box) => box.text === 'high' && box.props.radius === 'full')
  assert.equal(pill?.props.border, 'accent')
  const fields = view.find({ testId: 'detail-fields' })?.text ?? ''
  assert.match(fields, /^State\s*In Progress\s*Assignees\s*Dima\s*Labels\s*bug\s*Updated\s*\S/)
  // The update time is relative.
  assert.equal(view.find({ type: 'RelativeTime' })?.props.at, Date.parse(DETAIL.updatedAt))
  // Start work is the solid main action; Plane sits beside it, named Open in Plane.
  assert.deepEqual([view.find({ testId: 'start:WEB-1' })?.text, view.find({ testId: 'start:WEB-1' })?.props.variant], ['Start work', 'solid'])
  assert.equal(view.find({ type: 'Button', text: 'Plane' })?.props.tooltip, 'Open in Plane')
  // The description is plain text, not framed.
  assert.equal(view.findAll({ type: 'Box' }).some((box) => box.props.border === true), false)
  // The header's title, then the actions (Start first), then the description; findAll lists innermost matches in order.
  const order = view
    .findAll({})
    .flatMap((el) =>
      el.type === 'Heading' && el.text === 'Fix login' ? ['header'] : el.key === 'start:WEB-1' ? ['start'] : el.text === 'Plane' && el.type === 'Button' ? ['plane'] : el.type === 'Markdown' ? ['description'] : []
    )
  assert.deepEqual(order, ['header', 'start', 'plane', 'description'])
  await view.press({ type: 'Button', text: 'Plane' })
  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: DETAIL.url }])
  await view.press({ testId: 'start:WEB-1' })
  assert.ok(view.find({ type: 'Card', label: 'Start WEB-1' }))
  await view.press({ text: 'Confirm' })
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'failed', error: 'agent crashed', workspaceId: 'w5' } })
  assert.ok(view.find(part('agent crashed')))
  await view.press({ testId: 'start:WEB-1' })
  assert.deepEqual(opened, [{ workspaceId: 'w5' }])
  await view.press({ text: '← All items' })
  assert.ok(view.find({ testId: 'group:Todo' }))
  await view.unmount()
})

test('a long description opens collapsed; Show more and Show less toggle it; a short one has no button', async () => {
  const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${'word '.repeat(15).trim()}.`).join('\n\n')
  const descriptions: Record<string, string> = { 'WEB-1': long, 'WEB-2': long, 'WEB-3': 'Short.' }
  const host = connectedHost({
    'item.get': ({ key }: { key: string }) => ({ ok: true, item: { ...DETAIL, key, description: descriptions[key] } })
  })
  const view = await mount(panel, { host })
  const shown = () => view.find({ type: 'Markdown' })?.props.content as string
  await view.press({ testId: 'WEB-1' })
  assert.ok(shown().length < long.length && long.startsWith(shown()))
  await view.press({ text: 'Show more' })
  assert.equal(shown(), long)
  await view.press({ text: 'Show less' })
  assert.ok(shown().length < long.length)
  await view.press({ text: 'Show more' })
  await view.press({ text: '← All items' })
  await view.press({ testId: 'WEB-2' })
  assert.ok(shown().length < long.length, 'another item opens collapsed')
  assert.ok(view.find({ text: 'Show more' }))
  await view.press({ text: '← All items' })
  await view.press({ testId: 'WEB-3' })
  assert.equal(shown(), 'Short.')
  assert.equal(view.find({ text: 'Show more' }), null)
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

test('readiness hints before Start: one warning Callout of advice above the prompt; Confirm stays enabled', async () => {
  const ready = `${'The login page waits for the session check before it draws the form. '.repeat(3)}The code is in src/auth/login.ts.\n\n- [ ] The form draws first`
  const HINTS = ['No description', 'Short description', 'No checklist', 'No code reference or link']
  const cases: [string, string[]][] = [
    ['', ['No description']],
    ['Login is slow.', ['Short description', 'No checklist', 'No code reference or link']],
    [ready, []]
  ]
  for (const [description, hints] of cases) {
    const view = await mount(panel, { host: connectedHost({ 'item.get': { ok: true, item: { ...DETAIL, description } } }) })
    await view.press({ testId: 'start:WEB-1' })
    const callouts = view.findAll({ type: 'Callout' })
    if (hints.length === 0) assert.equal(callouts.length, 0, description)
    else {
      assert.equal(callouts.length, 1, description)
      assert.match(callouts[0].text, /This ticket may be hard for an agent/)
      assert.equal(callouts[0].props.tone, 'warning')
      assert.deepEqual(HINTS.filter((hint) => callouts[0].text.includes(hint)), hints)
    }
    assert.equal(view.find({ text: 'Confirm' })?.disabled, false)
    await view.unmount()
  }
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

// --- Links: agent state and the focused workspace (link-items-to-workspaces) ---

const badges = (view: Awaited<ReturnType<typeof mount>>) => view.findAll({ type: 'Badge' }).map((badge) => badge.text)

const rowIcon = (view: Finder, key: string) => {
  const button = view.find({ testId: `start:${key}` })
  return [button?.label, button?.props.icon]
}

test('agent state: the row workspace icon and its name; the detail Agent field; none when unknown or unlinked', async () => {
  const view = await mount(panel, {
    host: connectedHost(
      { 'links.get': { 'WEB-1': { workspaceId: 'w1', agent: null } } },
      { 'WEB-1': { kind: 'created', workspaceId: 'w1', name: 'WEB-1-title', projectId: 'p1' } }
    )
  })
  // Linked, no state reported yet: the plain workspace icon.
  assert.deepEqual(rowIcon(view, 'WEB-1'), ['Open workspace', 'open-external'])
  await view.post('links.changed', { 'WEB-1': { workspaceId: 'w1', agent: 'needs-input' } })
  assert.deepEqual(rowIcon(view, 'WEB-1'), ['Open workspace · Agent needs input', 'bell'])
  await view.post('links.changed', { 'WEB-1': { workspaceId: 'w1', agent: 'done' } })
  assert.deepEqual(rowIcon(view, 'WEB-1'), ['Open workspace · Agent done', 'check'])
  await view.press({ testId: 'WEB-1' })
  const agentField = view.find({ testId: 'detail-agent' })
  assert.deepEqual([agentField?.text, agentField?.props.tone], ['Done', 'success'])
  assert.match(view.find({ testId: 'detail-fields' })?.text ?? '', /Agent\s*Done/)
  await view.press({ text: '← All items' })
  // An agent in an unlinked workspace: the worker posts nothing, so no row changes.
  assert.deepEqual(rowIcon(view, 'WEB-1'), ['Open workspace · Agent done', 'check'])
  await view.post('links.changed', { 'WEB-1': { workspaceId: 'w1', agent: 'working' } })
  assert.deepEqual(rowIcon(view, 'WEB-1'), ['Open workspace · Agent working', 'agent'])
  await view.unmount()
})

test('focus on a linked workspace opens its item; an unlinked one keeps the panel as it is', async () => {
  const asked: unknown[] = []
  const view = await mount(panel, {
    host: connectedHost({
      'item.get': (input: unknown) => {
        asked.push(input)
        return { ok: true, item: DETAIL }
      }
    })
  })
  await view.post('focus.changed', { key: null })
  assert.ok(view.find({ testId: 'WEB-1' }))
  await view.post('focus.changed', { key: 'WEB-1' })
  assert.ok(detailOf(view, 'WEB-1', 'Fix login'))
  // A listed item is fetched with its project.
  assert.deepEqual(asked, [{ key: 'WEB-1', projectId: 'project-WEB' }])
  await view.post('focus.changed', { key: null })
  assert.ok(detailOf(view, 'WEB-1', 'Fix login'))
  // Back in the list while the same workspace stays focused: the worker posts nothing, the list stays.
  await view.press({ text: '← All items' })
  assert.ok(view.find({ testId: 'group:Todo' }))
  await view.unmount()
})

test('focus on the workspace of an item that left the list opens it by its key alone', async () => {
  const asked: unknown[] = []
  const gone: ItemDetail = { ...DETAIL, key: 'WEB-7', title: 'Shipped', url: 'https://app.plane.so/truelogic/browse/WEB-7/' }
  const view = await mount(panel, {
    host: connectedHost({
      'item.get': (input: unknown) => {
        asked.push(input)
        return { ok: true, item: gone }
      }
    })
  })
  await view.post('focus.changed', { key: 'WEB-7' })
  assert.ok(detailOf(view, 'WEB-7', 'Shipped'))
  assert.deepEqual(asked, [{ key: 'WEB-7' }])
  await view.unmount()
})

test('an open Start confirmation stays open when a linked workspace is focused', async () => {
  const view = await mount(panel, { host: connectedHost() })
  await view.press({ testId: 'start:WEB-2' })
  assert.ok(view.find({ type: 'Card', label: 'Start WEB-2' }))
  await view.post('focus.changed', { key: 'WEB-1' })
  assert.ok(view.find({ type: 'Card', label: 'Start WEB-2' }))
  assert.equal(detailOf(view, 'WEB-1', 'Fix login'), null)
  await view.unmount()
})

test('review 1: a links.changed that arrives while the panel loads is not overwritten by the older snapshot', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const view = await mount(panel, {
    host: connectedHost({
      'connection.get': { connected: false },
      'connection.connect': { ok: true, status: CONNECTED },
      'links.get': { 'WEB-1': { workspaceId: 'w1', agent: null } },
      'starts.get': { states: { 'WEB-1': { kind: 'created', workspaceId: 'w1', name: 'WEB-1-title', projectId: 'p1' } }, hidden: [] },
      'orca.projects': async () => {
        await held
        return { projects: [{ id: 'p1', name: 'repo', hostId: 'local' }] }
      }
    })
  })
  // Connecting loads the list, the Start states, the links and the pickers; the pickers are held.
  const connecting = view.press({ text: 'Connect' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  // The post lands while the pickers are held; they answer just after it.
  setTimeout(release, 50)
  await view.post('links.changed', { 'WEB-1': { workspaceId: 'w1', agent: 'needs-input' } })
  await connecting
  await view.settled()
  assert.equal(view.find({ testId: 'start:WEB-1' })?.label, 'Open workspace · Agent needs input')
  await view.unmount()
})

test('review 2: a Start state the worker reports idle (its workspace was deleted) offers Start again', async () => {
  const view = await mount(panel, {
    host: connectedHost({}, { 'WEB-1': { kind: 'created', workspaceId: 'w1', name: 'n', projectId: 'p1' } })
  })
  assert.equal(view.find({ testId: 'start:WEB-1' })?.label, 'Open workspace')
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'idle' } })
  assert.equal(view.find({ testId: 'start:WEB-1' })?.label, 'Start')
  await view.unmount()
})

test('round 2: Start states and the list posted while the panel loads are not overwritten by the older snapshots', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const view = await mount(panel, {
    host: connectedHost(
      {
        'connection.get': { connected: false },
        'connection.connect': { ok: true, status: CONNECTED },
        'orca.projects': async () => {
          await held
          return { projects: [{ id: 'p1', name: 'repo', hostId: 'local' }] }
        }
      },
      {
        'WEB-1': { kind: 'created', workspaceId: 'w1', name: 'n', projectId: 'p1' },
        'WEB-2': { kind: 'created', workspaceId: 'w2', name: 'n', projectId: 'p1' }
      }
    )
  })
  const connecting = view.press({ text: 'Connect' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  setTimeout(release, 50)
  // WEB-1's workspace was removed while the pickers were held; a refresh also ended.
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'idle' } })
  await view.post('items.changed', list({ items: [item('WEB-1', 'started'), item('WEB-2', 'unstarted'), item('WEB-4', 'unstarted')] }))
  await connecting
  await view.settled()
  assert.equal(view.find({ testId: 'start:WEB-1' })?.label, 'Start')
  // The snapshot's other keys still apply.
  assert.equal(view.find({ testId: 'start:WEB-2' })?.label, 'Open workspace')
  assert.ok(view.find({ testId: 'WEB-4' }))
  await view.unmount()
})

// --- start-history: Item detail shows earlier Starts (task 2.1) ---

const AT = 1_700_000_000_000
const attempt = (over: Partial<Attempt>): Attempt => ({
  id: String(over.at ?? AT),
  at: AT,
  agent: 'claude',
  project: 'repo',
  projectId: 'p1',
  workspace: 'WEB-1-fix-login',
  outcome: 'created',
  ...over
})
const earlier = (view: { findAll: Finder['findAll'] }) =>
  view.findAll({ type: 'ListItem' }).filter((row) => row.key?.startsWith('1'))

test('started before, workspace removed: the detail lists that Start with time, agent, project, workspace and created, and offers Start', async () => {
  const asked: unknown[] = []
  const view = await mount(panel, {
    host: connectedHost({
      'history.get': (input: unknown) => {
        asked.push(input)
        return [attempt({})]
      }
    })
  })
  await view.press({ testId: 'WEB-1' })
  assert.deepEqual(asked, [{ key: 'WEB-1' }])
  assert.ok(view.find({ type: 'Heading', text: 'Earlier starts' }))
  const [row] = earlier(view)
  assert.match(row.text, /Claude Code · repo/)
  assert.match(row.text, /WEB-1-fix-login/)
  assert.ok(view.find({ type: 'Badge', text: 'created' }))
  assert.ok(view.findAll({ type: 'RelativeTime' }).some((time) => time.props.at === AT))
  assert.equal(view.find({ testId: 'start:WEB-1' })?.text, 'Start work')
  await view.unmount()
})

test('a failed Start shows failed; pending and unknown show not confirmed; newest first; terminal only is named', async () => {
  let answer = [
    attempt({ at: AT, outcome: 'failed' }),
    attempt({ at: AT + 1, outcome: 'unknown', agent: null }),
    attempt({ at: AT + 2, outcome: 'pending', agent: 'codex' })
  ]
  const view = await mount(panel, { host: connectedHost({ 'history.get': () => answer }) })
  await view.press({ testId: 'WEB-1' })
  assert.deepEqual(earlier(view).map((row) => row.key), [String(AT + 2), String(AT + 1), String(AT)])
  assert.ok(view.find({ type: 'Badge', text: 'failed' }))
  assert.equal(view.findAll({ type: 'Badge', text: 'not confirmed' }).length, 2)
  assert.match(earlier(view)[0].text, /Codex/)
  assert.match(earlier(view)[1].text, /Terminal only/)
  // A Start state change of the open item fetches the history again.
  answer = [attempt({ at: AT, outcome: 'failed' }), attempt({ at: AT + 1, outcome: 'created', agent: null })]
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'idle' } })
  assert.equal(view.findAll({ type: 'Badge', text: 'not confirmed' }).length, 0)
  assert.ok(view.find({ type: 'Badge', text: 'created' }))
  await view.unmount()
})

test('an item that was never started shows no list of earlier Starts', async () => {
  const view = await mount(panel, { host: connectedHost({ 'history.get': [] }) })
  await view.press({ testId: 'WEB-1' })
  assert.ok(detailOf(view, 'WEB-1', 'Fix login'))
  assert.equal(view.find({ type: 'Heading', text: 'Earlier starts' }), null)
  assert.equal(view.find({ type: 'List', label: 'Earlier starts' }), null)
  await view.unmount()
})

test('review 1: a delayed history reply does not roll back a newer one', async () => {
  let calls = 0
  const view = await mount(panel, {
    host: connectedHost({
      'history.get': async () => {
        // The reply to opening the item comes late, after the one asked on start.changed.
        if (++calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 30))
          return [attempt({ outcome: 'pending' })]
        }
        return [attempt({ outcome: 'created' })]
      }
    })
  })
  const pressed = view.press({ testId: 'WEB-1' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await Promise.all([pressed, view.post('start.changed', { key: 'WEB-1', state: { kind: 'idle' } })])
  assert.equal(calls, 2)
  assert.ok(view.find({ type: 'Badge', text: 'created' }))
  assert.equal(view.find({ type: 'Badge', text: 'not confirmed' }), null)
  await view.unmount()
})

test('review 2: a direct switch to another connection drops the shown history and loads the new one', async () => {
  let answer = [attempt({ project: 'old-repo' })]
  const asked: unknown[] = []
  const view = await mount(panel, {
    host: connectedHost({
      'history.get': (input: unknown) => {
        asked.push(input)
        return answer
      }
    })
  })
  await view.press({ testId: 'WEB-1' })
  assert.match(earlier(view)[0].text, /old-repo/)
  answer = []
  await view.post('connection.changed', { ...CONNECTED, slug: 'other' })
  assert.equal(view.find({ type: 'Heading', text: 'Earlier starts' }), null)
  assert.deepEqual(asked, [{ key: 'WEB-1' }, { key: 'WEB-1' }])
  await view.unmount()
})

// --- closed-item-workspaces: the section of items no longer open (task 2.1) ---

const LEFTOVER = 'No longer in your open items (1)'
const created = (workspaceId: string, name: string): StartState => ({ kind: 'created', workspaceId, name, projectId: 'p1' })

test('an item finished in Plane leaves its tab and shows in the section with its workspace name', async () => {
  const opened: unknown[] = []
  const host = connectedHost(
    {
      'workspace.open': (input: unknown) => {
        opened.push(input)
        return { ok: true }
      }
    },
    { 'WEB-3': created('w3', 'WEB-3-title-web-3') }
  )
  const view = await mount(panel, { host })
  assert.equal(view.find({ type: 'Collapsible', label: LEFTOVER }), null)
  await view.post('items.changed', list({ items: [item('WEB-1', 'started'), item('WEB-2', 'unstarted')] }))
  assert.equal(view.find({ testId: 'WEB-3' }), null)
  const section = view.find({ type: 'Collapsible', label: LEFTOVER })
  assert.ok(section)
  assert.equal(section.props.defaultOpen, undefined)
  await view.toggle({ type: 'Collapsible', label: LEFTOVER })
  assert.ok(view.find({ text: 'WEB-3-title-web-3' }))
  // Open the leftover workspace.
  await view.press({ testId: 'leftover-open:WEB-3' })
  assert.deepEqual(opened, [{ workspaceId: 'w3' }])
  await view.unmount()
})

test('the section names the workspace of a failed agent, and shows the key alone for a link saved without a name', async () => {
  const host = connectedHost({}, {
    'OLD-1': { kind: 'failed', error: 'agent crashed', workspaceId: 'w1', name: 'OLD-1-fix-login-timeout' },
    'OLD-2': { kind: 'failed', error: 'agent crashed', workspaceId: 'w2' },
    // No workspace: nothing to show.
    'OLD-3': { kind: 'failed', error: 'refused' }
  })
  const view = await mount(panel, { host })
  await view.toggle({ type: 'Collapsible', label: 'No longer in your open items (2)' })
  assert.ok(view.find({ text: 'OLD-1-fix-login-timeout' }))
  assert.ok(view.find({ text: 'OLD-2' }))
  assert.ok(view.find({ testId: 'leftover-open:OLD-2' }))
  assert.equal(view.find({ testId: 'leftover-open:OLD-3' }), null)
  await view.unmount()
})

test('a partial, stale or failed list shows no section', async () => {
  for (const completeness of ['partial', 'stale', 'error'] as const) {
    const host = connectedHost({ 'items.list': list({ completeness, error: 'x' }) }, { 'OLD-1': created('w1', 'OLD-1-x') })
    const view = await mount(panel, { host })
    assert.equal(view.find({ type: 'Collapsible', label: LEFTOVER }), null, completeness)
    await view.unmount()
  }
})

test('Hide removes the entry and keeps the link; the hiding holds for a new panel', async () => {
  const asked: unknown[] = []
  let hidden: string[] = []
  const host = connectedHost({
    'starts.get': () => ({ states: { 'OLD-1': created('w1', 'OLD-1-x') }, hidden }),
    'start.hide': (input: { key: string }) => {
      asked.push(input)
      hidden = [input.key]
      return { ok: true }
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ type: 'Collapsible', label: LEFTOVER })
  await view.press({ testId: 'leftover-hide:OLD-1' })
  assert.deepEqual(asked, [{ key: 'OLD-1' }])
  // What the worker posts on a hide.
  await view.post('start.changed', { key: 'OLD-1', state: created('w1', 'OLD-1-x'), hidden: true })
  assert.equal(view.find({ type: 'Collapsible', label: LEFTOVER }), null)
  assert.equal(host.callsOf('workspace.remove').length, 0)
  await view.unmount()
  const again = await mount(panel, { host })
  assert.equal(again.find({ type: 'Collapsible', label: LEFTOVER }), null)
  await again.unmount()
})

test('a hidden item listed again offers Open workspace; once its workspace is removed, Start again', async () => {
  const host = connectedHost({ 'starts.get': { states: { 'WEB-1': created('w1', 'WEB-1-x') }, hidden: ['WEB-1'] } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ testId: 'start:WEB-1' })?.props.label, 'Open workspace')
  assert.equal(view.find({ type: 'Collapsible', label: LEFTOVER }), null)
  // The item leaves the list again: still hidden.
  await view.post('items.changed', list({ items: [item('WEB-2', 'unstarted')] }))
  assert.equal(view.find({ type: 'Collapsible', label: LEFTOVER }), null)
  // Removed in Orca: the link and the hiding end together.
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'idle' }, hidden: false })
  await view.post('items.changed', list())
  assert.equal(view.find({ testId: 'start:WEB-1' })?.props.label, 'Start')
  // A later link starts visible.
  await view.post('start.changed', { key: 'WEB-1', state: created('w9', 'WEB-1-x'), hidden: false })
  await view.post('items.changed', list({ items: [item('WEB-2', 'unstarted')] }))
  assert.ok(view.find({ type: 'Collapsible', label: LEFTOVER }))
  await view.unmount()
})

test('review 1: a direct switch to another account drops the old leftovers and loads the new ones', async () => {
  let answer = { states: { 'OLD-1': created('w1', 'OLD-1-x') }, hidden: [] as string[] }
  const view = await mount(panel, { host: connectedHost({ 'starts.get': () => answer }) })
  assert.ok(view.find({ type: 'Collapsible', label: LEFTOVER }))
  answer = { states: {}, hidden: [] }
  await view.post('connection.changed', { ...CONNECTED, slug: 'other' })
  await view.post('items.changed', list())
  assert.equal(view.find({ type: 'Collapsible', label: LEFTOVER }), null)
  await view.unmount()
})

test('review 1: a late Hide reply does not hide the workspace that replaced the hidden one', async () => {
  const host = connectedHost({
    'starts.get': { states: { 'OLD-1': created('w1', 'OLD-1-x') }, hidden: [] },
    'start.hide': async () => {
      // The reply comes after the worker's posts: the hide, the removal of w1 and a new link to w2.
      await new Promise((resolve) => setTimeout(resolve, 30))
      return { ok: true }
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ type: 'Collapsible', label: LEFTOVER })
  const pressed = view.press({ testId: 'leftover-hide:OLD-1' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await Promise.all([
    pressed,
    view.post('start.changed', { key: 'OLD-1', state: created('w1', 'OLD-1-x'), hidden: true }),
    view.post('start.changed', { key: 'OLD-1', state: { kind: 'idle' }, hidden: false }),
    view.post('start.changed', { key: 'OLD-1', state: created('w2', 'OLD-1-x'), hidden: false })
  ])
  assert.ok(view.find({ type: 'Collapsible', label: LEFTOVER }))
  await view.unmount()
})

test("review 2: a late detail reply from the former account does not replace the new account's detail", async () => {
  let account = 'A'
  const view = await mount(panel, {
    host: connectedHost({
      'item.get': async () => {
        const from = account
        // Account A's reply comes after the switch and after B's.
        if (from === 'A') await new Promise((resolve) => setTimeout(resolve, 30))
        return { ok: true, item: { ...DETAIL, title: `Title from ${from}` } }
      }
    })
  })
  const pressed = view.press({ testId: 'WEB-1' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  account = 'B'
  await Promise.all([pressed, view.post('connection.changed', { ...CONNECTED, slug: 'other' })])
  assert.ok(detailOf(view, 'WEB-1', 'Title from B'))
  assert.equal(detailOf(view, 'WEB-1', 'Title from A'), null)
  await view.unmount()
})

test('review 2: a reload that fails after an account switch shows the error with Retry', async () => {
  let fail = false
  const view = await mount(panel, {
    host: connectedHost({
      'starts.get': () => {
        if (fail) throw new Error('worker gone')
        return { states: {}, hidden: [] }
      }
    })
  })
  fail = true
  await view.post('connection.changed', { ...CONNECTED, slug: 'other' })
  assert.ok(view.find(part('worker gone')))
  fail = false
  await view.press({ text: 'Retry' })
  assert.equal(view.find(part('worker gone')), null)
  assert.ok(view.find({ testId: 'WEB-1' }))
  await view.unmount()
})

// --- keyboard-commands ---

/** The worker's item.lookup over one connection: parses as it does; Plane knows DIOGEN-12 only. */
function lookupHost(conn: { appBase: string; slug: string }, asked: string[] = []) {
  const other: ItemDetail = { ...DETAIL, key: 'DIOGEN-12', title: 'Not mine', projectId: 'project-DIOGEN', assignees: ['Someone'], url: browseUrl(conn.appBase, conn.slug, 'DIOGEN-12') }
  return connectedHost({
    'item.lookup': ({ text }: { text: string }) => {
      const ref = parseItemRef(text, conn)
      if ('reason' in ref) return { ok: false, error: ref.reason }
      asked.push(text)
      return 'key' in ref && ref.key === 'DIOGEN-12' ? { ok: true, item: other } : { ok: false, error: `No item has the key ${'key' in ref ? ref.key : ''}.` }
    }
  })
}

test('Open by key or URL: a key of an item assigned to someone else opens its detail', async () => {
  const view = await mount(panel, { host: lookupHost({ appBase: 'https://app.plane.so', slug: 'acme' }) })
  await typeLookup(view, 'diogen-12', { submit: true })
  assert.ok(detailOf(view, 'DIOGEN-12', 'Not mine'))
  assert.deepEqual(view.persisted.plugin['plane.open'], { key: 'DIOGEN-12', projectId: 'project-DIOGEN' })
  await view.press({ text: '← All items' })
  // The ⋯ part stays open after the lookup, with the field cleared.
  assert.equal(view.valueOf({ label: 'Open by key or URL' }), '')
  await view.unmount()
})

test('Open by key or URL: a pasted Cloud URL, and a self-hosted one under a path, open the detail', async () => {
  for (const conn of [{ appBase: 'https://app.plane.so', slug: 'acme' }, { appBase: 'https://plane.example.org/tools/plane', slug: 'acme' }]) {
    const view = await mount(panel, { host: lookupHost(conn) })
    await typeLookup(view, browseUrl(conn.appBase, conn.slug, 'DIOGEN-12'), { submit: true })
    assert.ok(detailOf(view, 'DIOGEN-12', 'Not mine'), conn.appBase)
    await view.unmount()
  }
})

test('Open by key or URL: a URL of another workspace and an unknown key say so and keep the list', async () => {
  const asked: string[] = []
  const view = await mount(panel, { host: lookupHost({ appBase: 'https://app.plane.so', slug: 'acme' }, asked) })
  await typeLookup(view, 'https://app.plane.so/other/browse/DIOGEN-12/', { submit: true })
  assert.ok(view.find(part('not from the connected Plane workspace')))
  assert.deepEqual(asked, [])
  await typeLookup(view, 'NOPE-1', { submit: true, replace: true })
  assert.ok(view.find(part('No item has the key NOPE-1.')))
  assert.ok(view.find({ testId: 'WEB-1' }))
  // Clearing the field drops the refusal, so the ⋯ part can be hidden again.
  await view.type({ label: 'Open by key or URL' }, '', { replace: true })
  assert.equal(view.find(part('No item has the key NOPE-1.')), null)
  await view.press({ label: 'Hide actions' })
  assert.equal(view.find({ label: 'Open by key or URL' }), null)
  await view.unmount()
})

test('Closed item: a completed item opened by key shows no Start; one linked to a workspace still opens it', async () => {
  const done: ItemDetail = { ...DETAIL, key: 'DIOGEN-7', title: 'Shipped', stateName: 'Done', stateGroup: 'unknown' }
  const view = await mount(panel, { host: connectedHost({ 'item.lookup': { ok: true, item: done } }) })
  await typeLookup(view, 'DIOGEN-7', { submit: true })
  assert.ok(detailOf(view, 'DIOGEN-7', 'Shipped'))
  assert.equal(view.find({ testId: 'start:DIOGEN-7' }), null)
  await view.post('start.changed', { key: 'DIOGEN-7', state: { kind: 'created', workspaceId: 'w7', name: 'DIOGEN-7-shipped', projectId: 'p1' }, hidden: false })
  assert.equal(view.find({ testId: 'start:DIOGEN-7' })?.text, 'Open workspace')
  await view.unmount()
})

test('an open item opened by key offers Start with the same confirmation', async () => {
  const other: ItemDetail = { ...DETAIL, key: 'DIOGEN-12', title: 'Not mine', stateGroup: 'unstarted', stateName: 'Todo' }
  const started: unknown[] = []
  const view = await mount(panel, {
    host: connectedHost({
      'item.lookup': { ok: true, item: other },
      'item.start': (input: unknown) => {
        started.push(input)
        return { accepted: true }
      }
    })
  })
  await typeLookup(view, 'DIOGEN-12', { submit: true })
  await view.press({ testId: 'start:DIOGEN-12' })
  assert.ok(view.find({ type: 'Card', label: 'Start DIOGEN-12' }))
  await view.press({ text: 'Confirm' })
  assert.equal((started[0] as { key: string }).key, 'DIOGEN-12')
  await view.unmount()
})

test('the panel tells the worker which item its detail shows, and when it shows none', async () => {
  const shown: unknown[] = []
  const view = await mount(panel, {
    host: connectedHost({
      'panel.shown': (input: unknown) => {
        shown.push(input)
        return { ok: true }
      }
    })
  })
  await view.press({ testId: 'WEB-1' })
  await view.press({ text: '← All items' })
  assert.deepEqual(shown, [{ key: 'WEB-1' }, { key: null }])
  await view.unmount()
})

test('review 1: a lookup reply that comes after the user opened another item does not replace it', async () => {
  const shown: unknown[] = []
  const log: string[] = []
  const late: ItemDetail = { ...DETAIL, key: 'WEB-8', title: 'Late' }
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const view = await mount(panel, {
    host: connectedHost({
      'item.lookup': async () => {
        log.push('lookup asked')
        await held
        log.push('lookup answers')
        return { ok: true, item: late }
      },
      'item.get': () => {
        log.push('item.get')
        return { ok: true, item: DETAIL }
      },
      'panel.shown': (input: unknown) => {
        shown.push(input)
        return { ok: true }
      }
    })
  })
  // The user submits WEB-8, then opens WEB-1 from its row before the lookup answers.
  await view.press({ label: 'Show actions' })
  const typed = view.type({ label: 'Open by key or URL' }, 'WEB-8', { submit: true })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const pressed = view.press({ testId: 'WEB-1' })
  setTimeout(release, 200)
  await Promise.all([typed, pressed])
  await view.settled()
  assert.deepEqual(log, ['lookup asked', 'item.get', 'lookup answers'])
  assert.ok(detailOf(view, 'WEB-1', 'Fix login'))
  assert.deepEqual(view.persisted.plugin['plane.open'], { key: 'WEB-1', projectId: 'project-WEB' })
  assert.deepEqual(shown, [{ key: 'WEB-1' }])
  await view.unmount()
})

test('review 2: a lookup reply that comes after the user opened a Start confirmation does not hide it', async () => {
  const log: string[] = []
  const late: ItemDetail = { ...DETAIL, key: 'WEB-8', title: 'Late' }
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const view = await mount(panel, {
    host: connectedHost({
      'item.lookup': async () => {
        log.push('lookup asked')
        await held
        log.push('lookup answers')
        return { ok: true, item: late }
      },
      'item.get': () => {
        log.push('item.get')
        return { ok: true, item: DETAIL }
      }
    })
  })
  // The user submits WEB-8, then presses Start on the WEB-1 row before the lookup answers.
  await view.press({ label: 'Show actions' })
  const typed = view.type({ label: 'Open by key or URL' }, 'WEB-8', { submit: true })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const pressed = view.press({ testId: 'start:WEB-1' })
  setTimeout(release, 200)
  await Promise.all([typed, pressed])
  await view.settled()
  assert.deepEqual(log, ['lookup asked', 'item.get', 'lookup answers'])
  assert.ok(view.find({ type: 'Card', label: 'Start WEB-1' }))
  assert.equal(detailOf(view, 'WEB-8', 'Late'), null)
  await view.unmount()
})
