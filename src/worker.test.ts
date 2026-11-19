// Runs src/worker.ts's activate(orca) over a mock host and a fake Plane server.
import { settings } from 'orca'
import { afterEach, assert, hostError, type MockHost, mockHost, mount, mountWorker, test } from 'orca/testing'
import page from '../test/fixtures/v2-list-page.json' with { type: 'json' }
import item from '../test/fixtures/v2-item.json' with { type: 'json' }
import { type FakeAnswer, fakeFetch } from './plane/fake-fetch'
import { connectionId } from './connection'
import type { ConnectInput } from './protocol'
import * as main from './worker'

// A failed assertion skips a test's deactivate; this stops its timers anyway.
afterEach(() => main.deactivate())

const USER = 'd9371857-5d13-4306-abe9-f3aefb05f40e'
const TOKEN = 'plane_api_SENTINEL_0123456789'
const CLOUD: ConnectInput = { hostKind: 'cloud', serverUrl: '', slug: 'truelogic', token: TOKEN }
const listPage = { ...page, has_more: false, next_cursor: null }
const NAME = 'DIOGEN-449-name'
const START = { key: 'DIOGEN-449', orcaProjectId: 'p1', hostId: 'local', agent: 'claude', prompt: 'Work on it', name: NAME }
const ROW = { id: 'w1', kind: 'worktree', name: NAME, projectId: 'p1', path: '/w', branch: 'b', hostId: 'local' }

type Route = (url: URL, init: RequestInit) => FakeAnswer | Promise<FakeAnswer>

/** A Plane server: users/me and the list, unless `route` answers first (non-undefined). */
function plane(route: (url: URL, init: RequestInit) => FakeAnswer | Promise<FakeAnswer> | undefined = () => undefined) {
  const handler: Route = async (url, init) => {
    const own = await route(url, init)
    if (own) return own
    if (url.pathname.endsWith('/users/me/')) return { json: { id: USER, display_name: 'Dima' } }
    if (url.pathname.endsWith('/work-items/')) return { json: listPage }
    if (url.pathname.includes('/work-items/DIOGEN-449/')) return { json: item }
    return { status: 404, json: { error: 'The requested resource was not found.' } }
  }
  return fakeFetch(handler)
}

function host(results: Record<string, unknown> = {}, seed: { storage?: Record<string, never>; secrets?: Record<string, string> } = {}) {
  return mockHost({
    results: {
      'secrets.protection': { status: 'os-keyring' },
      'statusBar.update': { ok: true },
      'workspace.list': { workspaces: [], truncated: false },
      ...results
    },
    ...seed
  })
}

async function until(check: () => boolean | Promise<boolean>, what = 'condition'): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for ${what}`)
}

/** A gate a fake answer can wait on. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { opened, open }
}

const statusTexts = (h: MockHost) =>
  h.callsOf('statusBar.update').map((p) => {
    const params = p as { visible?: boolean; text?: string }
    return params.visible === false ? 'hidden' : params.text
  })

async function connected(h = host()) {
  const worker = await mountWorker(main, { host: h })
  const answer = await worker.request('connection.connect', CLOUD)
  assert.equal(answer.ok, true, JSON.stringify(answer))
  await until(async () => (await worker.request('items.list')).completeness === 'complete', 'items')
  return worker
}

// --- 3. Connection ---

test('connect validates, saves one secret record, shows the user and loads the items', async () => {
  const fake = plane()
  const h = host()
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual(await worker.request('connection.get'), { connected: false })
  const answer = await worker.request('connection.connect', CLOUD)
  assert.deepEqual(answer, {
    ok: true,
    status: { connected: true, hostKind: 'cloud', server: 'https://app.plane.so', slug: 'truelogic', userName: 'Dima' }
  })
  assert.equal(h.callsOf('secrets.set').length, 1)
  const paths = fake.calls.slice(0, 2).map((call) => new URL(call.url).pathname)
  assert.deepEqual(paths, ['/api/v2/users/me/', '/api/v2/workspaces/truelogic/work-items/'])
  await until(async () => (await worker.request('items.list')).items.length === 2, 'items')
  const state = await worker.request('items.list')
  assert.equal(state.completeness, 'complete')
  assert.deepEqual(state.items.map((i) => i.key), ['DIOGEN-449', page.data[1].identifier])
  assert.equal(statusTexts(h).at(-1), '2')
  await worker.deactivate()
})

async function refused(route: Route, input = CLOUD) {
  const fake = plane(route as never)
  const h = host()
  const worker = await mountWorker(main, { host: h })
  const answer = await worker.request('connection.connect', input)
  assert.equal(h.callsOf('secrets.set').length, 0)
  assert.equal(h.callsOf('storage.set').length, 0)
  assert.deepEqual(await worker.request('connection.get'), { connected: false })
  await worker.deactivate()
  return { error: answer.ok ? '' : answer.error, calls: fake.calls }
}

test('invalid token: nothing saved, says the token is invalid', async () => {
  const { error } = await refused((url) => (url.pathname.endsWith('/users/me/') ? { status: 401, json: { detail: 'x' } } : undefined) as never)
  assert.equal(error, 'The token is invalid.')
})

test('unknown workspace: nothing saved, says the workspace was not found', async () => {
  const { error } = await refused((url) => (url.pathname.endsWith('/work-items/') ? { status: 404, json: { error: 'nf' } } : undefined) as never)
  assert.equal(error, 'Workspace "truelogic" was not found.')
})

test('server without API v2: HTML or a 404 on users/me', async () => {
  for (const answer of [
    { status: 200, body: '<!DOCTYPE html><html>', headers: { 'content-type': 'text/html' } },
    { status: 404, json: { detail: 'Not found.' } }
  ]) {
    const { error } = await refused((url) => (url.pathname.endsWith('/users/me/') ? answer : undefined) as never)
    assert.equal(error, 'This server is not supported: it does not serve Plane API v2.')
  }
})

test('unsafe server URLs are refused before any request; loopback http proceeds', async () => {
  for (const serverUrl of ['http://plane.example.com', 'https://me:pw@plane.example.com']) {
    const { error, calls } = await refused(() => undefined as never, { ...CLOUD, hostKind: 'self-hosted', serverUrl })
    assert.ok(error.length > 0)
    assert.equal(calls.length, 0)
  }
  const fake = plane()
  const worker = await mountWorker(main, { host: host() })
  const answer = await worker.request('connection.connect', { ...CLOUD, hostKind: 'self-hosted', serverUrl: 'http://localhost:8000' })
  assert.equal(answer.ok, true)
  assert.equal(new URL(fake.calls[0].url).origin, 'http://localhost:8000')
  await worker.deactivate()
})

test('no protected key store: refused, no secret and no storage write', async () => {
  const fake = plane()
  const h = host({ 'secrets.protection': { status: 'unavailable' } })
  const worker = await mountWorker(main, { host: h })
  const answer = await worker.request('connection.connect', CLOUD)
  assert.equal(answer.ok, false)
  assert.match(answer.ok ? '' : answer.error, /protected key store is required/)
  assert.equal(h.callsOf('secrets.set').length + h.callsOf('storage.set').length, 0)
  assert.equal(fake.calls.length, 0)
  await worker.deactivate()
})

test('a failed secret write leaves no connection', async () => {
  plane()
  const h = host({ 'secrets.set': () => { throw hostError('action_failed', 'disk full') } })
  const worker = await mountWorker(main, { host: h })
  const answer = await worker.request('connection.connect', CLOUD)
  assert.equal(answer.ok, false)
  assert.deepEqual(await worker.request('connection.get'), { connected: false })
  await worker.deactivate()
})

test('concurrent connects run in order; the last one wins', async () => {
  const fake = plane()
  const worker = await mountWorker(main, { host: host() })
  const [a, b] = await Promise.all([
    worker.request('connection.connect', CLOUD),
    worker.request('connection.connect', { ...CLOUD, hostKind: 'self-hosted', serverUrl: 'http://localhost:8000' })
  ])
  assert.equal(a.ok && b.ok, true)
  const origins = fake.calls.map((call) => new URL(call.url).origin)
  assert.deepEqual(origins.slice(0, 2), ['https://api.plane.so', 'https://api.plane.so'])
  assert.equal(origins.indexOf('http://localhost:8000') >= 2, true)
  const status = await worker.request('connection.get')
  assert.equal(status.connected && status.server, 'http://localhost:8000')
  await worker.deactivate()
})

test('switching account clears the old items and links; no old token goes to the new server', async () => {
  plane()
  const h = host()
  const worker = await connected(h)
  const oldKeys = Object.keys(h.data().storage)
  assert.ok(oldKeys.length > 0)
  const fake = plane((url) => (url.pathname.endsWith('/users/me/') ? { json: { id: 'other-user', display_name: 'Other' } } : undefined) as never)
  await worker.request('connection.connect', { ...CLOUD, hostKind: 'self-hosted', serverUrl: 'http://localhost:9000', token: 'plane_api_NEW' })
  for (const key of oldKeys) assert.equal(key in h.data().storage, false, key)
  for (const call of fake.calls) assert.equal((call.init.headers as Record<string, string>)['X-API-Key'], 'plane_api_NEW')
  await worker.deactivate()
})

test('disconnect during a refresh discards its result and clears everything', async () => {
  const hold = gate()
  let holding = false
  plane(async (url) => {
    if (holding && url.pathname.endsWith('/work-items/')) await hold.opened
    return undefined as never
  })
  const h = host()
  const worker = await connected(h)
  holding = true
  const listed = await worker.request('items.list', { force: true })
  assert.equal(listed.refreshing, true)
  assert.deepEqual(await worker.request('connection.disconnect'), { connected: false })
  hold.open()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(h.data().secrets, {})
  assert.deepEqual(Object.keys(h.data().storage).filter((key) => key.startsWith('c:')), [])
  assert.equal(statusTexts(h).at(-1), 'hidden')
  const last = worker.posts.filter((post) => post.event === 'items.changed').at(-1)
  assert.deepEqual((last?.payload as { items: unknown[] }).items, [])
  assert.deepEqual(await worker.request('connection.get'), { connected: false })
  await worker.deactivate()
})

/** The worker, with storage writes to keys ending in `suffix` held at `hold` while `held()` is true. */
function holdingWrites(suffix: string, hold: ReturnType<typeof gate>, held: () => boolean, entered: () => void) {
  return {
    ...main,
    default: (orca: Parameters<typeof main.default>[0]) => {
      // The host's objects are frozen: hand the worker ones that inherit from them.
      const set = orca.storage.set.bind(orca.storage)
      const heldSet = async (key: string, value: never) => {
        if (held() && key.endsWith(suffix)) {
          entered()
          await hold.opened
        }
        return set(key, value)
      }
      const storage = Object.create(orca.storage, { set: { value: heldSet } })
      return main.default(Object.create(orca, { storage: { value: storage } }))
    }
  }
}

test('disconnect while a refresh or a Start is writing: nothing is left and the status bar stays hidden', async () => {
  for (const suffix of [':items', ':starts']) {
    plane()
    const hold = gate()
    let holding = false
    let writing = false
    const h = host()
    const worker = await mountWorker(holdingWrites(suffix, hold, () => holding, () => (writing = true)), { host: h })
    assert.equal((await worker.request('connection.connect', CLOUD)).ok, true)
    await until(async () => (await worker.request('items.list')).completeness === 'complete', 'items')
    holding = true
    if (suffix === ':items') await worker.request('items.list', { force: true })
    else void worker.request('item.start', START)
    await until(() => writing, `${suffix} write`)
    // Disconnect waits for the write it raced; started before the write ends.
    const off = worker.request('connection.disconnect')
    await new Promise((resolve) => setTimeout(resolve, 10))
    hold.open()
    assert.deepEqual(await off, { connected: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(Object.keys(h.data().storage).filter((key) => key.startsWith('c:')), [], suffix)
    assert.equal(statusTexts(h).at(-1), 'hidden', suffix)
    await worker.deactivate()
  }
})

test('the token appears only in the secret record and the X-API-Key header to its origin', async () => {
  const fake = plane((url) =>
    (url.pathname.includes('/work-items/NOPE-1/') ? { status: 500, json: { detail: `echo ${TOKEN}` } } : undefined) as never
  )
  const h = host({
    'project.list': { projects: [{ id: 'p1', name: 'repo', kind: 'git', hostId: 'local', path: '/r' }], truncated: false },
    'workspace.create': { workspaceId: 'w1' },
    'workspace.list': { workspaces: [{ id: 'w1', kind: 'worktree', name: NAME, projectId: 'p1', path: '/w', branch: 'b', hostId: 'local' }], truncated: false },
    'workspace.open': { opened: true }
  })
  const worker = await mountWorker(main, { host: h })
  const results: unknown[] = []
  results.push(await worker.request('connection.connect', { ...CLOUD, slug: 'nope' }).catch((e: Error) => e.message))
  results.push(await worker.request('connection.connect', CLOUD))
  await until(async () => (await worker.request('items.list')).completeness === 'complete')
  results.push(await worker.request('connection.get'))
  results.push(await worker.request('items.list', { force: true }))
  results.push(await worker.request('item.get', { key: 'DIOGEN-449', projectId: page.data[0].project_id }))
  results.push(await worker.request('item.get', { key: 'NOPE-1', projectId: 'x' }))
  results.push(await worker.request('orca.projects'))
  results.push(await worker.request('item.start', { key: 'DIOGEN-449', orcaProjectId: 'p1', hostId: 'local', agent: 'claude', prompt: 'p', name: NAME }))
  await until(async () => (await worker.request('starts.get')).states['DIOGEN-449']?.kind === 'created')
  results.push(await worker.request('starts.get'))
  results.push(await worker.request('workspace.open', { workspaceId: 'w1' }))
  results.push(await worker.request('connection.disconnect'))

  const leaks = (value: unknown) => JSON.stringify(value ?? null).includes(TOKEN)
  assert.equal(leaks(results), false, 'request results')
  assert.equal(leaks(worker.posts), false, 'panel posts')
  assert.equal(leaks(worker.logs), false, 'logs')
  assert.equal(leaks(h.data().storage) || leaks(h.data().settings), false, 'storage and settings')
  const otherCalls = h.calls.filter((call) => !call.method.startsWith('secrets.'))
  assert.equal(leaks(otherCalls), false, 'host calls other than secrets')
  assert.ok(leaks(h.callsOf('secrets.set')), 'the secret record holds it')
  for (const call of fake.calls) {
    assert.equal(new URL(call.url).origin, 'https://api.plane.so')
    assert.equal(call.url.includes(TOKEN), false)
  }
  await worker.deactivate()
})

// --- 4. Items and status bar ---

test('items.list answers at once while a slow refresh runs, and joins one refresh', async () => {
  const hold = gate()
  let holding = false
  let lists = 0
  plane(async (url) => {
    if (url.pathname.endsWith('/work-items/')) {
      lists++
      if (holding) await hold.opened
    }
    return undefined as never
  })
  const h = host()
  const worker = await connected(h)
  holding = true
  const before = lists
  const first = await worker.request('items.list', { force: true })
  const second = await worker.request('items.list', { force: true })
  assert.equal(first.refreshing && second.refreshing, true)
  assert.equal(first.items.length, 2)
  hold.open()
  await until(async () => !(await worker.request('items.list')).refreshing)
  assert.equal(lists - before, 1)
  await worker.deactivate()
})

test('the result is stored even with no panel asking again', async () => {
  plane()
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await worker.request('connection.connect', CLOUD)
  await until(() => Object.entries(h.data().storage).some(([key, value]) => key.endsWith(':items') && (value as { fetchedAt: unknown }).fetchedAt !== null))
  await worker.deactivate()
})

test('a cache written before list items had labels reads as items with no labels', async () => {
  plane()
  const record = { token: TOKEN, apiBase: 'https://api.plane.so', appBase: 'https://app.plane.so', hostKind: 'cloud', slug: 'truelogic', userId: USER, userName: 'Dima' }
  const id = await connectionId(record.apiBase, record.slug, USER)
  const old = { id: 'i1', key: 'DIOGEN-1', title: 'Old', projectId: 'p', stateName: 'Todo', stateGroup: 'unstarted', priority: 'none', updatedAt: '' }
  const cache = { items: [old], completeness: 'complete', fetchedAt: Date.now(), error: null, checkedAt: Date.now() }
  const h = host({}, { secrets: { connection: JSON.stringify(record) }, storage: { [`c:${id}:items`]: cache as never } })
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual((await worker.request('items.list')).items, [{ ...old, labels: [] }])
  await worker.deactivate()
})

test('a failed refresh after a good one is stale and keeps the items; status ?', async () => {
  let fail = false
  plane((url) => (fail && url.pathname.endsWith('/work-items/') ? { status: 500, json: { detail: 'boom' } } : undefined) as never)
  const h = host()
  const worker = await connected(h)
  assert.equal(statusTexts(h).at(-1), '2')
  fail = true
  await worker.request('items.list', { force: true })
  await until(async () => (await worker.request('items.list')).completeness === 'stale')
  const state = await worker.request('items.list')
  assert.equal(state.items.length, 2)
  assert.match(state.error ?? '', /boom/)
  assert.equal(statusTexts(h).at(-1), '?')
  await worker.deactivate()
})

test('a partial list shows ? in the status bar; a first failure is error', async () => {
  plane((url) =>
    (url.pathname.endsWith('/work-items/') && !url.searchParams.get('cursor')
      ? { json: { ...page, has_more: true, next_cursor: 'c2' } }
      : url.searchParams.get('cursor') === 'c2'
        ? { status: 502, json: {} }
        : undefined) as never
  )
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await worker.request('connection.connect', CLOUD)
  await until(async () => (await worker.request('items.list')).completeness === 'partial')
  assert.equal(statusTexts(h).at(-1), '?')
  await worker.deactivate()
})

test('item.get returns the detail with text and the browse URL', async () => {
  plane()
  const worker = await connected()
  const answer = await worker.request('item.get', { key: 'DIOGEN-449', projectId: page.data[0].project_id })
  assert.equal(answer.ok, true)
  if (answer.ok) {
    assert.equal(answer.item.url, 'https://app.plane.so/truelogic/browse/DIOGEN-449/')
    assert.equal(answer.item.description, '<description_html>'.replace(/<[^>]*>/g, ''))
  }
  await worker.deactivate()
})

test('the background timer: configured interval, clamped, fires a refresh, stops on disconnect', async () => {
  const realSet = globalThis.setInterval
  const realClear = globalThis.clearInterval
  const armed: { ms: number; fn: () => void; id: number }[] = []
  const cleared: number[] = []
  let next = 1
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    armed.push({ fn, ms, id: next })
    return next++
  }) as never
  globalThis.clearInterval = ((id: number) => cleared.push(id)) as never
  try {
    let lists = 0
    plane((url) => {
      if (url.pathname.endsWith('/work-items/')) lists++
      return undefined as never
    })
    const h = mockHost({
      results: { 'secrets.protection': { status: 'os-keyring' }, 'statusBar.update': { ok: true } },
      settings: { refreshMinutes: 2 }
    })
    const worker = await connected(h)
    const live = armed.filter((timer) => !cleared.includes(timer.id))
    assert.deepEqual(live.map((timer) => timer.ms), [5 * 60_000])
    const before = lists
    live[0].fn()
    await until(() => lists > before, 'timer refresh')
    // The person changes the setting: a panel on the same host writes it.
    const view = await mount(() => null, { host: h })
    await settings.set('refreshMinutes', 7)
    await until(() => armed.filter((timer) => !cleared.includes(timer.id)).map((timer) => timer.ms).join() === String(7 * 60_000), 're-arm')
    await view.unmount()
    await worker.request('connection.disconnect')
    assert.equal(armed.filter((timer) => !cleared.includes(timer.id)).length, 0)
    await worker.deactivate()
  } finally {
    globalThis.setInterval = realSet
    globalThis.clearInterval = realClear
  }
})

test('disconnected: the status bar is hidden and no timer runs', async () => {
  plane()
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await until(() => statusTexts(h).length > 0)
  assert.deepEqual(statusTexts(h), ['hidden'])
  assert.equal((await worker.request('items.list')).completeness, null)
  await worker.deactivate()
})

// --- 5. Start ---

const startOf = async (worker: Awaited<ReturnType<typeof mountWorker>>) => (await worker.request('starts.get')).states['DIOGEN-449']

test('double press from two panels creates one workspace', async () => {
  plane()
  const hold = gate()
  let rows: unknown[] = []
  const h = host({
    'workspace.create': async () => {
      await hold.opened
      return { workspaceId: 'w1' }
    },
    'workspace.list': () => ({ workspaces: rows, truncated: false })
  })
  const worker = await connected(h)
  // The mock host queues storage writes behind a host call still running, so the gate opens on
  // a timer; the pending state shows in the posts.
  setTimeout(hold.open, 50)
  const [a, b] = await Promise.all([
    worker.request('item.start', START, { panel: 'plane' }),
    worker.request('item.start', START, { panel: 'plane' })
  ])
  assert.deepEqual([a.accepted, b.accepted].sort(), [false, true])
  assert.ok(worker.posts.some((post) => post.event === 'start.changed' && (post.payload as { state: { kind: string } }).state.kind === 'pending'))
  rows = [ROW]
  await until(async () => (await startOf(worker))?.kind === 'created')
  assert.equal(h.callsOf('workspace.create').length, 1)
  assert.deepEqual(h.callsOf('workspace.create')[0], { projectId: 'p1', hostId: 'local', name: NAME, agent: 'claude', prompt: 'Work on it' })
  assert.equal((await worker.request('item.start', START)).accepted, false)
  assert.ok(worker.posts.some((post) => post.event === 'start.changed' && (post.payload as { state: { kind: string } }).state.kind === 'created'))
  await worker.deactivate()
})

test('terminal only: no agent and no prompt are sent', async () => {
  plane()
  const h = host({ 'workspace.create': { workspaceId: 'w1' }, 'workspace.list': { workspaces: [ROW], truncated: false } })
  const worker = await connected(h)
  await worker.request('item.start', { ...START, agent: null, hostId: null })
  await until(async () => (await startOf(worker))?.kind === 'created')
  assert.deepEqual(h.callsOf('workspace.create')[0], { projectId: 'p1', name: NAME })
  await worker.deactivate()
})

test('the create hook gives a Start the branch the confirmation showed while it runs, and passes every other create unchanged', async () => {
  // The confirmation names the workspace from the fresh detail title; the cached list still says `<name>`.
  const name = 'DIOGEN-449-fix-login-timeout'
  const others = [
    { kind: 'worktree' as const, projectId: 'p1', name: 'other-name' },
    { kind: 'worktree' as const, projectId: 'p2', name },
    { kind: 'folder' as const, projectId: 'p1', name }
  ]
  for (const fail of [false, true]) {
    plane()
    const hold = gate()
    let rows: unknown[] = []
    const h = host({
      'workspace.create': async () => {
        await hold.opened
        if (fail) throw hostError('invalid_params', 'bad project')
        rows = [{ ...ROW, name }]
        return { workspaceId: 'w1' }
      },
      'workspace.list': () => ({ workspaces: rows, truncated: false })
    })
    const worker = await connected(h)
    const fire = (event: { kind: 'worktree' | 'folder'; projectId: string; name: string }) =>
      worker.hooks.fire('workspace.create.before', event)
    // The mock answers a request or a hook only once no host call is running, so the create is
    // released on a timer; the hook decides while it is still held.
    const started = worker.request('item.start', { ...START, name })
    await until(() => h.callsOf('workspace.create').length === 1, 'create called')
    const during = Promise.all([fire({ kind: 'worktree', projectId: 'p1', name }), ...others.map(fire)])
    setTimeout(hold.open, 50)
    assert.deepEqual(await during, [
      { kind: 'continue', event: { kind: 'worktree', projectId: 'p1', name, branch: name } },
      ...others.map((event) => ({ kind: 'continue', event }))
    ])
    assert.equal((await started).accepted, true)
    assert.equal((h.callsOf('workspace.create')[0] as { name: string }).name, name)
    await until(async () => (await startOf(worker))?.kind === (fail ? 'failed' : 'created'), 'settled')
    // The start history records the same attempt, under the name the branch got.
    const attempts = await worker.request('history.get', { key: 'DIOGEN-449' })
    assert.deepEqual(attempts.map((attempt) => [attempt.workspace, attempt.outcome]), [[name, fail ? 'failed' : 'created']])
    // The entry is gone once the create settles, after success and after failure.
    assert.deepEqual(await fire({ kind: 'worktree', projectId: 'p1', name }), {
      kind: 'continue',
      event: { kind: 'worktree', projectId: 'p1', name }
    })
    await worker.deactivate()
  }
})

test('a Start whose name does not fit its key is refused and creates nothing', async () => {
  plane()
  const h = host({ 'workspace.create': { workspaceId: 'w1' } })
  const worker = await connected(h)
  for (const name of ['DIOGEN-4490-x', 'OTHER-1-name', 'DIOGEN-449-Name', 'DIOGEN-449-', `DIOGEN-449-${'a'.repeat(41)}`, '']) {
    const answer = await worker.request('item.start', { ...START, name })
    assert.equal(answer.accepted, false, name)
  }
  assert.equal(h.callsOf('workspace.create').length, 0)
  assert.equal(await startOf(worker), undefined)
  await worker.deactivate()
})

test('a lost reply or a worker restart: pending becomes unknown, then reconciles by name', async () => {
  for (const found of [true, false]) {
    plane()
    const record = { token: TOKEN, apiBase: 'https://api.plane.so', appBase: 'https://app.plane.so', hostKind: 'cloud', slug: 'truelogic', userId: USER, userName: 'Dima' }
    const id = await connectionId(record.apiBase, record.slug, USER)
    const pending = { kind: 'pending', name: NAME, projectId: 'p1', startedAt: 1 }
    let listed = false
    const h = mockHost({
      results: {
        'secrets.protection': { status: 'os-keyring' },
        'statusBar.update': { ok: true },
        'workspace.list': () => {
          listed = true
          return { workspaces: found ? [ROW] : [], truncated: false }
        }
      },
      secrets: { connection: JSON.stringify(record) },
      storage: { [`c:${id}:starts`]: { 'DIOGEN-449': pending } }
    })
    const worker = await mountWorker(main, { host: h })
    await until(() => (h.data().storage[`c:${id}:starts`] as Record<string, { kind: string }>)['DIOGEN-449']?.kind === 'unknown', 'unknown')
    assert.equal(listed, false)
    const state = await startOf(worker)
    if (found) assert.deepEqual(state, { kind: 'created', workspaceId: 'w1', name: NAME, projectId: 'p1' })
    else assert.equal(state, undefined)
    await worker.deactivate()
  }
})

test('history: the attempts survive a worker remount, and a disconnect and reconnect empties them', async () => {
  plane()
  const h = host({
    'project.list': { projects: [{ id: 'p1', name: 'repo', kind: 'git', hostId: 'local', path: '/r' }], truncated: false },
    'workspace.create': { workspaceId: 'w1' }
  })
  const worker = await connected(h)
  assert.deepEqual(await worker.request('history.get', { key: 'DIOGEN-449' }), [])
  assert.deepEqual(await worker.request('item.start', START), { accepted: true })
  await until(async () => (await worker.request('history.get', { key: 'DIOGEN-449' }))[0]?.outcome === 'created', 'created')
  await worker.deactivate()

  const again = await mountWorker(main, { host: h })
  const [attempt] = await again.request('history.get', { key: 'DIOGEN-449' })
  assert.deepEqual(
    { ...attempt, id: '', at: 0 },
    { id: '', at: 0, agent: 'claude', project: 'repo', projectId: 'p1', workspace: NAME, outcome: 'created' }
  )
  await again.request('connection.disconnect')
  assert.deepEqual(await again.request('history.get', { key: 'DIOGEN-449' }), [])
  assert.equal((await again.request('connection.connect', CLOUD)).ok, true)
  assert.deepEqual(await again.request('history.get', { key: 'DIOGEN-449' }), [])
  await again.deactivate()
})

test('an unknown outcome refuses Start until it is reconciled', async () => {
  plane()
  const h = host({
    'workspace.create': () => { throw hostError('timeout', 'gone') },
    'workspace.list': () => { throw hostError('unavailable', 'no') }
  })
  const worker = await connected(h)
  await worker.request('item.start', START)
  await until(async () => (await startOf(worker))?.kind === 'unknown')
  const again = await worker.request('item.start', START)
  assert.equal(again.accepted, false)
  assert.equal(h.callsOf('workspace.create').length, 1)
  await worker.deactivate()
})

test('the agent fails after the workspace exists: failed, linked to it', async () => {
  plane()
  let rows: unknown[] = []
  const h = host({
    'workspace.create': () => {
      rows = [{ id: 'w5', kind: 'worktree', name: NAME, projectId: 'p1', path: '/w', branch: 'b', hostId: 'local' }]
      throw hostError('action_failed', 'Agent claude failed to start in workspace w5')
    },
    'workspace.list': () => ({ workspaces: rows, truncated: false })
  })
  const worker = await connected(h)
  await worker.request('item.start', START)
  await until(async () => (await startOf(worker))?.kind === 'failed')
  assert.deepEqual(await startOf(worker), { kind: 'failed', error: 'Agent claude failed to start in workspace w5', workspaceId: 'w5', name: NAME })
  assert.equal((await worker.request('item.start', START)).accepted, false)
  // Hidden from the section of items no longer open, the link stays (closed-item-workspaces C2).
  assert.deepEqual(await worker.request('start.hide', { key: 'DIOGEN-449' }), { ok: true })
  assert.deepEqual((await worker.request('starts.get')).hidden, ['DIOGEN-449'])
  assert.equal((await worker.request('item.start', START)).accepted, false)
  await worker.deactivate()
})

test('a create failure is failed without a workspace and Start is offered again', async () => {
  plane()
  let calls = 0
  let rows: unknown[] = []
  const h = host({
    'workspace.create': () => {
      if (calls++ === 0) throw hostError('invalid_params', 'bad project')
      rows = [ROW]
      return { workspaceId: 'w1' }
    },
    'workspace.list': () => ({ workspaces: rows, truncated: false })
  })
  const worker = await connected(h)
  await worker.request('item.start', START)
  await until(async () => (await startOf(worker))?.kind === 'failed')
  assert.deepEqual(await startOf(worker), { kind: 'failed', error: 'bad project' })
  assert.equal((await worker.request('item.start', START)).accepted, true)
  await until(async () => (await startOf(worker))?.kind === 'created')
  await worker.deactivate()
})

test('a linked workspace that was deleted offers Start again', async () => {
  plane()
  let rows: unknown[] = []
  const h = host({
    'workspace.create': () => {
      rows = [{ id: 'w1', kind: 'worktree', name: NAME, projectId: 'p1', path: '/w', branch: 'b', hostId: 'local' }]
      return { workspaceId: 'w1' }
    },
    'workspace.list': () => ({ workspaces: rows, truncated: false })
  })
  const worker = await connected(h)
  await worker.request('item.start', START)
  await until(async () => (await startOf(worker))?.kind === 'created')
  rows = []
  assert.equal(await startOf(worker), undefined)
  assert.equal((await worker.request('item.start', START)).accepted, true)
  await worker.deactivate()
})

test('orca.projects offers Git projects only, with id and hostId; workspace.open opens', async () => {
  plane()
  const h = host({
    'project.list': {
      projects: [
        { id: 'p1', name: 'repo', kind: 'git', hostId: 'local', path: '/r' },
        { id: 'f1', name: 'notes', kind: 'folder', hostId: 'local', path: '/n' },
        { id: 'p2', name: 'remote', kind: 'git', hostId: 'ssh:box', path: '/x' }
      ],
      truncated: false
    },
    'workspace.open': { opened: true }
  })
  const worker = await mountWorker(main, { host: h })
  assert.deepEqual(await worker.request('orca.projects'), {
    projects: [
      { id: 'p1', name: 'repo', hostId: 'local' },
      { id: 'p2', name: 'remote', hostId: 'ssh:box' }
    ]
  })
  assert.deepEqual(await worker.request('workspace.open', { workspaceId: 'w1' }), { ok: true })
  assert.deepEqual(h.callsOf('workspace.open'), [{ workspaceId: 'w1' }])
  await worker.deactivate()
})

// --- Links: agent state, status bar, focus (link-items-to-workspaces) ---

const RECORD = { token: TOKEN, apiBase: 'https://api.plane.so', appBase: 'https://app.plane.so', hostKind: 'cloud', slug: 'truelogic', userId: USER, userName: 'Dima' }
const KEY2 = page.data[1].identifier as string
const ROW2 = { ...ROW, id: 'w2', name: 'other-name', path: '/w2' }
const linked = (workspaceId: string) => ({ kind: 'created', workspaceId, name: workspaceId === 'w1' ? NAME : 'other-name', projectId: 'p1' })

/** A worker already connected, with Start links stored for it; `rows()` is what workspace.list lists. */
async function withLinks(
  states: Record<string, unknown>,
  rows: () => unknown[],
  results: Record<string, unknown> = {},
  storage: Record<string, unknown> = {}
) {
  const id = await connectionId(RECORD.apiBase, RECORD.slug, USER)
  const h = mockHost({
    results: {
      'secrets.protection': { status: 'os-keyring' },
      'statusBar.update': { ok: true },
      'workspace.list': () => ({ workspaces: rows(), truncated: false }),
      ...results
    },
    secrets: { connection: JSON.stringify(RECORD) },
    storage: { [`c:${id}:starts`]: states, ...storage } as never
  })
  const worker = await mountWorker(main, { host: h })
  await until(async () => Object.keys(await worker.request('links.get')).length === Object.keys(states).length, 'links')
  await worker.request('items.list')
  await until(async () => (await worker.request('items.list')).completeness === 'complete', 'items')
  return { worker, h, id }
}

const agentEvent = (workspaceListId: string, state: 'working' | 'blocked' | 'waiting' | 'done', receivedAt = 1000) => ({
  workspaceId: `p1::/${workspaceListId}`,
  workspaceListId,
  paneKey: 'pane',
  terminalId: `t-${workspaceListId}`,
  state,
  receivedAt
})

const lastLinks = (worker: { posts: readonly { event: string; payload?: unknown }[] }) =>
  worker.posts.filter((post) => post.event === 'links.changed').at(-1)?.payload as Record<string, { agent: string | null }> | undefined

const startPosts = (worker: { posts: readonly { event: string; payload?: unknown }[] }) =>
  worker.posts.filter((post) => post.event === 'start.changed').map((post) => post.payload as { key: string; state: { kind: string } })

const lastBar = (h: MockHost) => h.callsOf('statusBar.update').at(-1) as { text?: string; tone?: string; tooltip?: string; visible?: boolean }
const NORMAL = { id: 'count', visible: true, text: '2', tone: 'neutral', tooltip: 'Plane: open work items assigned to you' }

test('an agent waiting in a linked workspace: needs-input at once, and the status bar counts the waiting agents', async () => {
  plane()
  const { worker, h } = await withLinks({ 'DIOGEN-449': linked('w1'), [KEY2]: linked('w2') }, () => [ROW, ROW2])
  assert.deepEqual(lastBar(h), NORMAL)
  assert.deepEqual(await worker.request('links.get'), {
    'DIOGEN-449': { workspaceId: 'w1', agent: null },
    [KEY2]: { workspaceId: 'w2', agent: null }
  })
  await worker.emit('agent.status.changed', agentEvent('w1', 'waiting'))
  assert.equal(lastLinks(worker)?.['DIOGEN-449'].agent, 'needs-input')
  assert.deepEqual(lastBar(h), { id: 'count', visible: true, text: '2 · 1 waiting', tone: 'warning', tooltip: '1 agent on Plane items waits for you' })
  await worker.emit('agent.status.changed', agentEvent('w2', 'blocked'))
  assert.deepEqual(lastBar(h), { id: 'count', visible: true, text: '2 · 2 waiting', tone: 'warning', tooltip: '2 agents on Plane items wait for you' })
  await worker.emit('agent.status.changed', agentEvent('w1', 'working'))
  assert.equal(lastBar(h).text, '2 · 1 waiting')
  // A list refresh while one agent waits keeps the suffix.
  const updates = h.callsOf('statusBar.update').length
  await worker.request('items.list', { force: true })
  await until(() => h.callsOf('statusBar.update').length > updates, 'refresh')
  assert.deepEqual(lastBar(h), { id: 'count', visible: true, text: '2 · 1 waiting', tone: 'warning', tooltip: '1 agent on Plane items waits for you' })
  await worker.emit('agent.status.changed', agentEvent('w2', 'done'))
  assert.deepEqual(lastBar(h), NORMAL)
  assert.deepEqual(await worker.request('links.get'), {
    'DIOGEN-449': { workspaceId: 'w1', agent: 'working' },
    [KEY2]: { workspaceId: 'w2', agent: 'done' }
  })
  await worker.deactivate()
})

test('a waiting workspace removed with no further agent event: no badge, the count back in its normal tone', async () => {
  plane()
  let rows: unknown[] = [ROW, ROW2]
  const { worker, h, id } = await withLinks({ 'DIOGEN-449': linked('w1'), [KEY2]: linked('w2') }, () => rows)
  await worker.emit('agent.status.changed', agentEvent('w1', 'waiting'))
  assert.equal(lastBar(h).tone, 'warning')
  rows = [ROW2]
  await worker.emit('workspace.removed', { workspaceId: 'p1::/w1', workspaceListId: 'w1', kind: 'worktree', path: '/w' })
  assert.deepEqual(lastBar(h), NORMAL)
  await until(() => !('DIOGEN-449' in (h.data().storage[`c:${id}:starts`] as object)), 'reconciled')
  assert.deepEqual(lastLinks(worker), { [KEY2]: { workspaceId: 'w2', agent: null } })
  // Review 2: an open panel hears that the Start state is gone, so it offers Start again.
  assert.ok(startPosts(worker).some((post) => post.key === 'DIOGEN-449' && post.state.kind === 'idle'))
  await worker.deactivate()
})

test("a link dropped by starts.get's reconcile: no badge, the count back in its normal tone", async () => {
  plane()
  let rows: unknown[] = [ROW]
  const { worker, h } = await withLinks({ 'DIOGEN-449': linked('w1') }, () => rows)
  await worker.emit('agent.status.changed', agentEvent('w1', 'waiting'))
  assert.equal(lastBar(h).text, '2 · 1 waiting')
  rows = []
  assert.deepEqual(await worker.request('starts.get'), { states: {}, hidden: [] })
  assert.deepEqual(lastLinks(worker), {})
  assert.ok(startPosts(worker).some((post) => post.key === 'DIOGEN-449' && post.state.kind === 'idle'))
  assert.deepEqual(lastBar(h), NORMAL)
  await worker.deactivate()
})

test('links.get is empty after a disconnect, and the status bar is hidden', async () => {
  plane()
  const { worker, h } = await withLinks({ 'DIOGEN-449': linked('w1') }, () => [ROW])
  await worker.emit('agent.status.changed', agentEvent('w1', 'waiting'))
  await worker.request('connection.disconnect')
  assert.deepEqual(await worker.request('links.get'), {})
  assert.deepEqual(lastLinks(worker), {})
  assert.equal(statusTexts(h).at(-1), 'hidden')
  await worker.deactivate()
})

test("a reconnect while a rebuild is in flight finishes and shows only the new account's links", async () => {
  let user = USER
  plane((url) => (url.pathname.endsWith('/users/me/') ? { json: { id: user, display_name: 'Someone' } } : undefined) as never)
  const other = await connectionId(RECORD.apiBase, RECORD.slug, 'other-user')
  const hold = gate()
  let holding = false
  const rows = [ROW, { ...ROW2, id: 'wB' }]
  const { worker } = await withLinks(
    { 'DIOGEN-449': linked('w1') },
    () => rows,
    {
      'workspace.list': async () => {
        if (holding) await hold.opened
        return { workspaces: rows, truncated: false }
      }
    },
    // What an earlier session of the other account left.
    { [`c:${other}:starts`]: { 'B-1': { kind: 'created', workspaceId: 'wB', name: 'other-name', projectId: 'p1' } } }
  )
  holding = true
  // A Start read of the old account holds the Start lock while the account switches.
  const read = worker.request('starts.get')
  // The mock host queues storage writes behind a running host call, so the gate opens on a timer.
  setTimeout(hold.open, 50)
  user = 'other-user'
  const switched = await worker.request('connection.connect', CLOUD)
  assert.equal(switched.ok, true)
  const from = worker.posts.length
  await read
  await until(async () => 'B-1' in (await worker.request('links.get')), 'new links')
  assert.deepEqual(await worker.request('links.get'), { 'B-1': { workspaceId: 'wB', agent: null } })
  const later = worker.posts.slice(from).filter((post) => post.event === 'links.changed')
  assert.ok(later.every((post) => !('DIOGEN-449' in (post.payload as object))))
  await worker.deactivate()
})

test('item.get without a projectId fetches the item by its key alone', async () => {
  const fake = plane()
  const worker = await connected()
  const answer = await worker.request('item.get', { key: 'DIOGEN-449' })
  assert.equal(answer.ok, true)
  assert.equal(new URL(fake.calls.at(-1)!.url).pathname, '/api/v2/workspaces/truelogic/work-items/DIOGEN-449/')
  await worker.deactivate()
})

test('focus: the context Orca sends on subscribe posts nothing; a linked workspace posts its key once', async () => {
  plane()
  const { worker } = await withLinks({ 'DIOGEN-449': linked('w1') }, () => [ROW])
  const focus = () => worker.posts.filter((post) => post.event === 'focus.changed').map((post) => post.payload)
  const context = (workspaceId: string) => ({ context: { workspaceId, branch: 'main', displayName: 'x', terminals: [] } })
  assert.deepEqual(focus(), [])
  await worker.emit('workspace.changed', context('w1'))
  await worker.emit('workspace.changed', context('w1'))
  await worker.emit('workspace.changed', context('w9'))
  assert.deepEqual(focus(), [{ key: 'DIOGEN-449' }, { key: null }])
  await worker.deactivate()
})

test('review 3: an explicit removal drops the link even when the workspace list is truncated', async () => {
  plane()
  let truncated = false
  const { worker } = await withLinks({ 'DIOGEN-449': linked('w1') }, () => [ROW], {
    'workspace.list': () => ({ workspaces: truncated ? [] : [ROW], truncated })
  })
  truncated = true
  await worker.emit('workspace.removed', { workspaceId: 'p1::/w1', workspaceListId: 'w1', kind: 'worktree', path: '/w' })
  await until(async () => Object.keys(await worker.request('links.get')).length === 0, 'link dropped')
  assert.ok(startPosts(worker).some((post) => post.key === 'DIOGEN-449' && post.state.kind === 'idle'))
  await worker.deactivate()
})
