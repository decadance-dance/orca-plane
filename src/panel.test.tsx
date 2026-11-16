// The panel over a mock host whose `requests` stand in for src/worker.ts.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { Item, ItemDetail } from './plane/map'
import * as panel from './panel'
import type { ConnectInput, ItemsState, StartState } from './protocol'

/** Callouts and list items read as their title plus their text, so match a part. */
const part = (text: string) => ({ text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })

const CONNECTED = { connected: true as const, hostKind: 'cloud' as const, server: 'https://app.plane.so', slug: 'truelogic', userName: 'Dima' }

const item = (key: string, stateGroup: Item['stateGroup'], title = `Title ${key}`): Item => ({
  id: key,
  key,
  title,
  projectId: 'plane-project',
  stateName: stateGroup === 'unknown' ? null : stateGroup,
  stateGroup,
  priority: 'high',
  updatedAt: '2026-11-16T18:20:38Z'
})

const list = (over: Partial<ItemsState> = {}): ItemsState => ({
  items: [item('WEB-1', 'started'), item('WEB-2', 'unstarted'), item('WEB-3', 'unstarted')],
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
  description: 'First paragraph.\n\nSecond paragraph.',
  url: 'https://app.plane.so/truelogic/browse/WEB-1/'
}

function connectedHost(extra: Record<string, unknown> = {}, starts: Record<string, StartState> = {}) {
  return mockHost({
    requests: {
      'connection.get': CONNECTED,
      'items.list': list(),
      'starts.get': starts,
      'item.get': { ok: true, item: DETAIL },
      'orca.projects': { projects: [{ id: 'p1', name: 'repo', hostId: 'local' }] },
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
  assert.ok(view.find({ label: 'WEB-1 Title WEB-1' }))
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

// --- 6.2 List ---

test('the list is grouped by state group with a completeness badge', async () => {
  const view = await mount(panel, { host: connectedHost() })
  assert.ok(view.find({ type: 'List', label: 'In progress (1)' }))
  assert.ok(view.find({ type: 'List', label: 'To do (2)' }))
  assert.equal(view.find({ type: 'List', label: /Backlog/ }), null)
  assert.ok(view.find({ type: 'Badge', text: 'Complete' }))
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

test('refresh asks for a forced refresh; posts update the list and the Start state', async () => {
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
  assert.ok(view.find({ type: 'List', label: 'Backlog (1)' }))
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'pending', name: 'n', projectId: 'p1', startedAt: 1 } })
  assert.ok(view.find({ type: 'Badge', text: 'Starting' }))
  await view.post('start.changed', { key: 'WEB-9', state: { kind: 'created', workspaceId: 'w', name: 'n', projectId: 'p1' } })
  assert.ok(view.find({ type: 'Badge', text: 'Workspace' }))
  await view.unmount()
})

// --- 6.3 Detail and Start ---

test('the detail shows its fields, opens in Plane and starts with the chosen project and agent', async () => {
  const started: unknown[] = []
  const host = connectedHost({
    'item.start': (input: unknown) => {
      started.push(input)
      return { accepted: true }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: /^WEB-1 / })
  assert.ok(view.find({ text: 'WEB-1 Fix login' }))
  assert.ok(view.find({ text: 'Second paragraph.' }))
  assert.match(view.find({ type: 'KeyValue' })?.text ?? '', /bug/)
  await view.press({ text: 'Open in Plane' })
  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: DETAIL.url }])
  assert.equal(view.valueOf({ label: 'Project' }), 'p1')
  assert.match(String(view.valueOf({ label: 'Prompt' })), /BEGIN PLANE TICKET/)
  await view.select({ label: 'Agent' }, 'none')
  await view.press({ text: 'Start' })
  assert.equal(started.length, 1)
  assert.deepEqual({ ...(started[0] as object), prompt: '' }, {
    key: 'WEB-1',
    orcaProjectId: 'p1',
    hostId: 'local',
    agent: null,
    prompt: ''
  })
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'pending', name: 'n', projectId: 'p1', startedAt: 1 } })
  assert.equal(view.find({ text: 'Starting…' })?.disabled, true)
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'unknown', name: 'n', projectId: 'p1' } })
  assert.equal(view.find({ text: 'Checking…' })?.disabled, true)
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'created', workspaceId: 'w1', name: 'n', projectId: 'p1' } })
  assert.ok(view.find({ text: 'Open workspace' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a refused start shows its reason; an agent failure offers Open workspace', async () => {
  const opened: unknown[] = []
  const host = connectedHost({
    'item.start': { accepted: false, reason: 'A start for this item is already running.' },
    'workspace.open': (input: unknown) => {
      opened.push(input)
      return { ok: true }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: /^WEB-1 / })
  await view.press({ text: 'Start' })
  assert.ok(view.find(part('A start for this item is already running.')))
  await view.post('start.changed', { key: 'WEB-1', state: { kind: 'failed', error: 'agent crashed', workspaceId: 'w5' } })
  assert.ok(view.find(part('agent crashed')))
  await view.press({ text: 'Open workspace' })
  assert.deepEqual(opened, [{ workspaceId: 'w5' }])
  await view.unmount()
})

test('no Git projects: a hint instead of the project picker, Start disabled', async () => {
  const view = await mount(panel, { host: connectedHost({ 'orca.projects': { projects: [] } }) })
  await view.press({ text: /^WEB-1 / })
  assert.ok(view.find(part('No Git projects')))
  assert.equal(view.find({ label: 'Project' }), null)
  assert.equal(view.find({ text: 'Start' })?.disabled, true)
  await view.press({ text: 'All items' })
  assert.ok(view.find({ type: 'List', label: 'To do (2)' }))
  await view.unmount()
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
