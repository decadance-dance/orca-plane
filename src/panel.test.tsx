// The panel over a mock host whose `requests` stand in for src/worker.ts.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { Item, ItemDetail } from './plane/map'
import * as panel from './panel'
import type { ConnectInput, ItemsState, StartState } from './protocol'

/** Callouts and list items read as their title plus their text, so match a part. */
const part = (text: string) => ({ text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })

const CONNECTED = { connected: true as const, hostKind: 'cloud' as const, server: 'https://app.plane.so', slug: 'truelogic', userName: 'Dima' }

const item = (key: string, stateGroup: Item['stateGroup'], title = `Title ${key}`, labels: string[] = []): Item => ({
  id: key,
  key,
  title,
  projectId: 'plane-project',
  stateName: stateGroup === 'unknown' ? null : stateGroup,
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
  assert.ok(view.find({ label: 'WEB-1 · Title WEB-1' }))
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

test('the list: collapsible state groups with counts, rows with badges, a completeness badge', async () => {
  const view = await mount(panel, { host: connectedHost() })
  assert.ok(view.find({ type: 'Collapsible', label: 'In progress' }))
  assert.match(view.find({ type: 'Collapsible', label: 'To do' })?.text ?? '', /2 items/)
  assert.equal(view.find({ type: 'Collapsible', label: 'Backlog' }), null)
  assert.ok(view.find({ type: 'Badge', text: 'Complete' }))
  const row = view.find({ label: 'WEB-2 · Title WEB-2' })
  assert.match(row?.text ?? '', /high/)
  assert.match(row?.text ?? '', /auth/)
  // The title is text; Open opens the item.
  assert.equal(view.find({ type: 'Link' }), null)
  assert.equal(view.find({ testId: 'open:WEB-2' })?.text, 'Open')
  assert.equal(view.find({ testId: 'start:WEB-2' })?.text, 'Start')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('search filters by key, title or label; nothing matching offers Clear search', async () => {
  const view = await mount(panel, { host: connectedHost() })
  await view.type({ label: 'Search' }, 'AUTH')
  const links = () => view.findAll({ type: 'ListItem' }).map((row) => row.label)
  assert.deepEqual(links(), ['WEB-2 · Title WEB-2'])
  await view.type({ label: 'Search' }, 'web-3', { replace: true })
  assert.deepEqual(links(), ['WEB-3 · Title WEB-3'])
  await view.type({ label: 'Search' }, 'title web-1', { replace: true })
  assert.deepEqual(links(), ['WEB-1 · Title WEB-1'])
  await view.type({ label: 'Search' }, 'zzz', { replace: true })
  assert.ok(view.find({ label: 'No matching items' }))
  // The badge describes the whole list, not the filtered one.
  assert.ok(view.find({ type: 'Badge', text: 'Complete' }))
  await view.press({ text: 'Clear search' })
  assert.equal(view.findAll({ type: 'ListItem' }).length, 3)
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
  assert.deepEqual([button()?.text, button()?.disabled], ['Starting…', true])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'unknown', name: 'n', projectId: 'p1' } })
  assert.deepEqual([button()?.text, button()?.disabled], ['Checking…', true])
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'failed', error: 'refused' } })
  assert.ok(view.find({ type: 'Badge', text: 'Start failed' }))
  assert.equal(button()?.text, 'Start')
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'created', workspaceId: 'w', name: 'n', projectId: 'p1' } })
  assert.equal(button()?.text, 'Open workspace')
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
  await view.press({ testId: 'open:WEB-1' })
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
  assert.ok(view.find({ type: 'Collapsible', label: 'To do' }))
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
