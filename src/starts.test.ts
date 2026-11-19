// Races between the connection and Start, driven by hand over a fake host whose replies the test holds.
import type { OrcaWorkerApi } from 'orca/worker'
import { assert, hostError, test } from 'orca/testing'
import page from '../test/fixtures/v2-list-page.json' with { type: 'json' }
import { Connections, connectionId, keyOf } from './connection'
import type { Items } from './items'
import { Links } from './links'
import { fakeFetch } from './plane/fake-fetch'
import { env } from './plane/http'
import type { Attempt } from './protocol'
import { append, settle as settleAttempt, Starts } from './starts'

const USER = 'd9371857-5d13-4306-abe9-f3aefb05f40e'
const RECORD = { token: 'old-token', apiBase: 'https://api.plane.so', appBase: 'https://app.plane.so', hostKind: 'cloud', slug: 'truelogic', userId: USER, userName: 'Dima' }
const NAME = 'DIOGEN-449-name'
const START = { key: 'DIOGEN-449', orcaProjectId: 'p1', hostId: 'local', agent: null, prompt: '', name: NAME }
const OTHER_ROW = { id: 'w9', kind: 'worktree', name: 'OTHER-1-x', projectId: 'p1', path: '/o', branch: 'o', hostId: 'local' }

function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { opened, open }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(check(), `timed out waiting for ${what}`)
}

/** A worker API over in-memory storage and secrets; `calls` answers host methods. */
function fake(calls: Record<string, (params: unknown) => unknown>, seed: { storage?: Record<string, unknown> } = {}) {
  const storage = new Map(Object.entries(seed.storage ?? {}))
  const secrets = new Map([['connection', JSON.stringify(RECORD)]])
  const counts: Record<string, number> = {}
  const orca = {
    secrets: {
      get: async (key: string) => secrets.get(key) ?? null,
      set: async (key: string, value: string) => void secrets.set(key, value),
      delete: async (key: string) => void secrets.delete(key)
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        // As Orca: a value over 256 KiB is refused.
        if (new TextEncoder().encode(JSON.stringify(value)).length > 262_144) throw hostError('too_large', 'value exceeds 262144 bytes')
        storage.set(key, value)
      },
      delete: async (key: string) => void storage.delete(key),
      keys: async () => [...storage.keys()]
    },
    host: {
      call: async (method: string, params?: unknown) => {
        counts[method] = (counts[method] ?? 0) + 1
        return calls[method](params)
      }
    },
    panels: { post: () => undefined }
  }
  return { orca: orca as unknown as OrcaWorkerApi, storage, counts }
}

const items = { state: async () => ({ items: [{ key: 'DIOGEN-449', title: 'name' }] }) } as unknown as Items
const oldId = () => connectionId(RECORD.apiBase, RECORD.slug, USER)

test('a secret read that ends after disconnect does not bring the connection back', async () => {
  const f = fake({})
  const hold = gate()
  const get = f.orca.secrets.get
  // The read takes its value, then its reply is late.
  ;(f.orca.secrets as { get: typeof get }).get = async (key) => {
    const value = await get(key)
    await hold.opened
    return value
  }
  const conns = new Connections(f.orca)
  const first = conns.status()
  assert.deepEqual(await conns.disconnect(), { connected: false })
  hold.open()
  assert.deepEqual(await first, { connected: false })
  assert.deepEqual(await conns.status(), { connected: false })
})

test('a Start that completes after an account switch writes nothing into the new account', async () => {
  fakeFetch((url) => {
    if (url.pathname.endsWith('/users/me/')) return { json: { id: 'new-user', display_name: 'New' } }
    return { json: { ...page, has_more: false, next_cursor: null } }
  })
  const created = gate()
  const listed = gate()
  let holdList = false
  let listing = false
  const f = fake(
    {
      'secrets.protection': () => ({ status: 'os-keyring' }),
      'workspace.create': async () => {
        await created.opened
        return { workspaceId: 'old-created' }
      },
      'workspace.list': async () => {
        if (holdList) {
          listing = true
          await listed.opened
        }
        return { workspaces: [OTHER_ROW], truncated: false }
      }
    },
    { storage: { [keyOf(await oldId(), 'starts')]: { 'OTHER-1': { kind: 'created', workspaceId: 'w9', name: 'OTHER-1-x', projectId: 'p1' } } } }
  )
  const conns = new Connections(f.orca)
  const starts = new Starts(f.orca, conns, items)
  assert.deepEqual(await starts.start(START), { accepted: true })
  // Another read holds the Start lock in workspace.list; the completion queues behind it.
  holdList = true
  const all = starts.all()
  await until(() => listing, 'workspace.list')
  created.open()
  await settle()
  const switched = await conns.connect({ hostKind: 'cloud', serverUrl: '', slug: 'other', token: 'new-token' })
  assert.equal(switched.ok, true, JSON.stringify(switched))
  listed.open()
  await all
  await settle()
  const newId = (await conns.current())!.id
  assert.equal(f.storage.get(keyOf(newId, 'starts')), undefined)
  assert.equal(f.storage.get(keyOf(newId, 'history')), undefined)
  assert.deepEqual(await starts.all(), {})
})

test("account switch: a create of account A that returns after B's rebuild never reaches the hooks (A4)", async () => {
  fakeFetch((url) => {
    if (url.pathname.endsWith('/users/me/')) return { json: { id: 'new-user', display_name: 'New' } }
    return { json: { ...page, has_more: false, next_cursor: null } }
  })
  const created = gate()
  const newId = await connectionId(RECORD.apiBase, 'other', 'new-user')
  const f = fake(
    {
      'secrets.protection': () => ({ status: 'os-keyring' }),
      'workspace.create': async () => {
        await created.opened
        return { workspaceId: 'old-created', terminalId: 't-old' }
      },
      'workspace.list': async () => ({ workspaces: [OTHER_ROW], truncated: false }),
      'terminal.list': async () => ({ terminals: [], truncated: false })
    },
    { storage: { [keyOf(newId, 'starts')]: { 'OTHER-1': { kind: 'created', workspaceId: 'w9', name: 'OTHER-1-x', projectId: 'p1' } } } }
  )
  const conns = new Connections(f.orca)
  const starts = new Starts(f.orca, conns, items)
  // Wired as the worker wires them.
  const links = new Links({ changed: () => undefined, focus: () => undefined })
  starts.onWrite((states) => links.set(states))
  starts.onCreated((key, workspaceId, terminalId) => links.adopt(key, workspaceId, terminalId))
  let rebuilt: Promise<unknown> = Promise.resolve()
  conns.onChange((conn) => {
    links.clear()
    links.connection(conn)
    rebuilt = starts.all()
  })
  links.connection(await conns.current())
  assert.deepEqual(await starts.start(START), { accepted: true })
  await until(() => (f.counts['workspace.create'] ?? 0) === 1, 'create called')
  const switched = await conns.connect({ hostKind: 'cloud', serverUrl: '', slug: 'other', token: 'new-token' })
  assert.equal(switched.ok, true, JSON.stringify(switched))
  await rebuilt
  assert.equal(links.launch({ workspaceId: 'w9' })?.key, 'OTHER-1', "B's rebuild finished")
  created.open()
  await settle()
  assert.equal(links.launch({ workspaceId: 'old-created', terminalId: 't-new' }), null)
  assert.equal(links.itemOfTerminal('t-old'), null)
  assert.equal(links.itemOfTerminal('t-new'), null)
})

test('two creates of one name in flight: the first to settle keeps the branch for the other', async () => {
  fakeFetch((url) => {
    if (url.pathname.endsWith('/users/me/')) return { json: { id: 'new-user', display_name: 'New' } }
    return { json: { ...page, has_more: false, next_cursor: null } }
  })
  const holds = [gate(), gate()]
  let calls = 0
  const f = fake({
    'secrets.protection': () => ({ status: 'os-keyring' }),
    'workspace.create': async () => {
      const call = calls++
      await holds[call].opened
      return { workspaceId: `w${call}` }
    },
    'workspace.list': () => ({ workspaces: [], truncated: false })
  })
  const conns = new Connections(f.orca)
  const starts = new Starts(f.orca, conns, items)
  assert.deepEqual(await starts.start(START), { accepted: true })
  await until(() => calls === 1, 'first create')
  // Another account has the same item key and title, started into the same Orca project.
  const switched = await conns.connect({ hostKind: 'cloud', serverUrl: '', slug: 'other', token: 'new-token' })
  assert.equal(switched.ok, true, JSON.stringify(switched))
  assert.deepEqual(await starts.start(START), { accepted: true })
  await until(() => calls === 2, 'second create')
  holds[0].open()
  await settle()
  assert.equal(starts.branchFor('p1', NAME), NAME)
  holds[1].open()
  await settle()
  assert.equal(starts.branchFor('p1', NAME), undefined)
})

test('a truncated workspace list keeps a link or an unknown outcome it does not show', async () => {
  const states = [
    { kind: 'created', workspaceId: 'w1', name: NAME, projectId: 'p1' },
    { kind: 'unknown', name: NAME, projectId: 'p1' },
    { kind: 'failed', error: 'agent failed', workspaceId: 'w1' }
  ]
  for (const state of states) {
    const f = fake(
      { 'workspace.list': () => ({ workspaces: [OTHER_ROW], truncated: true }), 'workspace.create': () => ({ workspaceId: 'w2' }) },
      { storage: { [keyOf(await oldId(), 'starts')]: { 'DIOGEN-449': state } } }
    )
    const starts = new Starts(f.orca, new Connections(f.orca), items)
    assert.deepEqual((await starts.all())['DIOGEN-449'], state, state.kind)
    assert.equal((await starts.start(START)).accepted, false, state.kind)
    assert.equal(f.counts['workspace.create'], undefined, state.kind)
  }
})

test('a failed create missing from a truncated list is unknown, not failed without a workspace', async () => {
  const f = fake({
    'workspace.list': () => ({ workspaces: [OTHER_ROW], truncated: true }),
    'workspace.create': () => {
      throw hostError('action_failed', 'Agent failed to start')
    }
  })
  const starts = new Starts(f.orca, new Connections(f.orca), items)
  assert.deepEqual(await starts.start(START), { accepted: true })
  await settle()
  assert.deepEqual((await starts.all())['DIOGEN-449'], { kind: 'unknown', name: NAME, projectId: 'p1' })
})

// --- start-history: the log (tasks 1.1 and 1.2) ---

const ROW = { id: 'w1', kind: 'worktree', name: NAME, projectId: 'p1', path: '/w', branch: 'b', hostId: 'local' }
const attempt = (over: Partial<Attempt> = {}): Attempt => ({
  id: '1',
  at: 1,
  agent: 'claude',
  project: 'repo',
  projectId: 'p1',
  workspace: NAME,
  outcome: 'pending',
  ...over
})

test('history: an append, an update by id done twice, the 10-per-item and the 50-item caps', () => {
  const history: Record<string, Attempt[]> = {}
  append(history, 'A-1', attempt())
  assert.deepEqual(Object.entries(history), [['A-1', [attempt()]]])
  settleAttempt(history, 'A-1', '1', 'created')
  const once = JSON.stringify(history)
  settleAttempt(history, 'A-1', '1', 'created')
  settleAttempt(history, 'A-1', 'gone', 'failed')
  assert.equal(JSON.stringify(history), once)
  assert.equal(history['A-1'][0].outcome, 'created')

  for (let at = 2; at <= 12; at++) append(history, 'A-1', attempt({ id: String(at), at }))
  assert.deepEqual(history['A-1'].map((entry) => entry.at), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

  // 50 more items, all newer than A-1 (newest 12) but B-0: the item whose newest attempt is oldest goes.
  for (let i = 0; i < 50; i++) append(history, `B-${i}`, attempt({ id: String(i), at: i === 0 ? 0 : 100 + i }))
  assert.equal(Object.keys(history).length, 50)
  assert.equal(history['B-0'], undefined)
  assert.ok(history['A-1'] && history['B-1'] && history['B-49'])
  append(history, 'B-50', attempt({ at: 1000 }))
  assert.equal(Object.keys(history).length, 50)
  assert.equal(history['A-1'], undefined)
})

const twoItems = {
  state: async () => ({ items: [{ key: 'DIOGEN-449', title: 'name' }, { key: 'DIOGEN-450', title: 'other' }] })
} as unknown as Items

test('history: two Starts of different items at once are both kept, with agent, project name and workspace', async () => {
  const f = fake({
    'project.list': () => ({ projects: [{ id: 'p1', name: 'repo', kind: 'git', hostId: 'local' }] }),
    'workspace.create': () => ({ workspaceId: 'w1' }),
    'workspace.list': () => ({ workspaces: [], truncated: false })
  })
  const starts = new Starts(f.orca, new Connections(f.orca), twoItems)
  const answers = await Promise.all([
    starts.start({ ...START, agent: 'claude' }),
    starts.start({ ...START, key: 'DIOGEN-450', name: 'DIOGEN-450-other' })
  ])
  assert.deepEqual(answers, [{ accepted: true }, { accepted: true }])
  await settle()
  const first = await starts.history('DIOGEN-449')
  assert.equal(first.length, 1)
  assert.deepEqual(
    { ...first[0], id: '', at: 0 },
    { id: '', at: 0, agent: 'claude', project: 'repo', projectId: 'p1', workspace: NAME, outcome: 'created' }
  )
  assert.notEqual(first[0].id, (await starts.history('DIOGEN-450'))[0].id)
  const second = await starts.history('DIOGEN-450')
  assert.deepEqual([second.length, second[0].agent, second[0].workspace, second[0].outcome], [1, null, 'DIOGEN-450-other', 'created'])
})

test('history: a refused create is failed; the project falls back to its id when Orca cannot list projects', async () => {
  const f = fake({
    'workspace.list': () => ({ workspaces: [], truncated: false }),
    'workspace.create': () => {
      throw hostError('invalid_params', 'No such project')
    }
  })
  const starts = new Starts(f.orca, new Connections(f.orca), items)
  assert.deepEqual(await starts.start(START), { accepted: true })
  await settle()
  const [entry] = await starts.history('DIOGEN-449')
  assert.deepEqual([entry.outcome, entry.project], ['failed', 'p1'])
})

test('history: a worker stop after the pending write resolves by name on reconcile; an attempt without a state too', async () => {
  const cases = [
    { name: 'found', rows: [ROW], state: true, outcome: 'created' },
    { name: 'missing from a complete list', rows: [OTHER_ROW], state: true, outcome: 'failed' },
    { name: 'state never written', rows: [ROW], state: false, outcome: 'created' },
    { name: 'state never written, missing', rows: [OTHER_ROW], state: false, outcome: 'failed' }
  ]
  for (const c of cases) {
    const id = await oldId()
    const f = fake(
      { 'workspace.list': () => ({ workspaces: c.rows, truncated: false }) },
      {
        storage: {
          [keyOf(id, 'history')]: { 'DIOGEN-449': [attempt({ id: '7', at: 7 })] },
          ...(c.state ? { [keyOf(id, 'starts')]: { 'DIOGEN-449': { kind: 'pending', name: NAME, projectId: 'p1', startedAt: 7 } } } : {})
        }
      }
    )
    // The restarted worker.
    const starts = new Starts(f.orca, new Connections(f.orca), items)
    await starts.recover()
    assert.equal((await starts.history('DIOGEN-449'))[0].outcome, 'unknown', c.name)
    await starts.all()
    assert.equal((await starts.history('DIOGEN-449'))[0].outcome, c.outcome, c.name)
  }
})

test('history: a truncated list keeps an unknown attempt it does not show', async () => {
  const f = fake(
    { 'workspace.list': () => ({ workspaces: [OTHER_ROW], truncated: true }) },
    { storage: { [keyOf(await oldId(), 'history')]: { 'DIOGEN-449': [attempt({ outcome: 'unknown' })] } } }
  )
  const starts = new Starts(f.orca, new Connections(f.orca), items)
  await starts.all()
  assert.equal((await starts.history('DIOGEN-449'))[0].outcome, 'unknown')
})

test('review 1: a repeated clock reading does not let one Start overwrite the outcome of another', async () => {
  const now = env.now
  env.now = () => 5
  try {
    let refuse = false
    let rows = [ROW]
    const f = fake({
      'workspace.create': () => {
        if (refuse) throw hostError('invalid_params', 'No such project')
        return { workspaceId: 'w1' }
      },
      'workspace.list': () => ({ workspaces: rows, truncated: false })
    })
    const starts = new Starts(f.orca, new Connections(f.orca), items)
    assert.deepEqual(await starts.start(START), { accepted: true })
    await settle()
    // The workspace is removed; the next Start, at the same millisecond, is refused.
    rows = []
    await starts.dropWorkspace(['w1'])
    refuse = true
    assert.deepEqual(await starts.start(START), { accepted: true })
    await settle()
    const attempts = await starts.history('DIOGEN-449')
    assert.deepEqual(attempts.map((entry) => entry.outcome), ['created', 'failed'])
    assert.notEqual(attempts[0].id, attempts[1].id)
  } finally {
    env.now = now
  }
})

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

test('review 1: a Start is still recorded when the history was close to the 256 KiB storage limit', async () => {
  // As the reviewer seeded it: items with five attempts each, just under the limit.
  const seed: Record<string, Attempt[]> = {}
  for (let i = 0; bytes(seed) < 262_144 - 2_000; i++) {
    seed[`OLD-${i}`] = [1, 2, 3, 4, 5].map((n) => attempt({ id: `${i}-${n}`, at: n, workspace: `OLD-${i}-a-workspace-name-of-some-length` }))
  }
  // One more item, padded to 50 bytes under the limit: the next attempt cannot fit beside it.
  seed.LAST = [attempt({ id: 'last', at: 1, workspace: '' })]
  seed.LAST[0].workspace = 'w'.repeat(262_144 - 50 - bytes(seed))
  assert.equal(bytes(seed), 262_144 - 50)
  const f = fake(
    { 'workspace.create': () => ({ workspaceId: 'w1' }), 'workspace.list': () => ({ workspaces: [], truncated: false }) },
    { storage: { [keyOf(await oldId(), 'history')]: seed } }
  )
  const starts = new Starts(f.orca, new Connections(f.orca), items)
  assert.deepEqual(await starts.start(START), { accepted: true })
  await settle()
  assert.deepEqual((await starts.history('DIOGEN-449')).map((entry) => entry.outcome), ['created'])
})

test('history: the byte guard drops the oldest items while the value is over 200 KiB, never the newest', () => {
  const history: Record<string, Attempt[]> = {}
  const project = 'p'.repeat(1_000)
  for (let i = 0; i < 50; i++) {
    for (let n = 0; n < 10; n++) append(history, `A-${i}`, attempt({ id: `${i}-${n}`, at: i * 100 + n, project }))
  }
  assert.ok(bytes(history) <= 200 * 1024)
  assert.ok(Object.keys(history).length < 50)
  assert.ok(history['A-49'])
  assert.equal(history['A-0'], undefined)
})

// --- closed-item-workspaces: workspace names and hiding (tasks 1.1 and 1.2) ---

test('an agent that fails after the workspace exists keeps the workspace name; a link saved without one stays valid', async () => {
  const f = fake({
    'workspace.list': () => ({ workspaces: [ROW], truncated: false }),
    'workspace.create': () => {
      throw hostError('action_failed', 'Agent failed to start')
    }
  })
  const starts = new Starts(f.orca, new Connections(f.orca), items)
  assert.deepEqual(await starts.start(START), { accepted: true })
  await settle()
  assert.deepEqual((await starts.all())['DIOGEN-449'], { kind: 'failed', error: 'Agent failed to start', workspaceId: 'w1', name: NAME })

  const old = { kind: 'failed', error: 'Agent failed to start', workspaceId: 'w1' }
  const g = fake({ 'workspace.list': () => ({ workspaces: [ROW], truncated: false }) }, { storage: { [keyOf(await oldId(), 'starts')]: { 'DIOGEN-449': old } } })
  const earlier = new Starts(g.orca, new Connections(g.orca), items)
  assert.deepEqual((await earlier.all())['DIOGEN-449'], old)
  assert.equal((await earlier.start(START)).accepted, false)
})

test('hide keeps the link and its duplicate protection, survives a remount, and ends with the workspace', async () => {
  const linked = { kind: 'created', workspaceId: 'w1', name: NAME, projectId: 'p1' }
  let rows = [ROW]
  const f = fake(
    { 'workspace.list': () => ({ workspaces: rows, truncated: false }), 'workspace.create': () => ({ workspaceId: 'w2' }) },
    { storage: { [keyOf(await oldId(), 'starts')]: { 'DIOGEN-449': linked } } }
  )
  const posts: unknown[] = []
  ;(f.orca.panels as { post: (event: string, payload: unknown) => void }).post = (event, payload) => void posts.push({ event, payload })
  const starts = new Starts(f.orca, new Connections(f.orca), items)
  // Only a linked key can be hidden.
  await starts.hide('OTHER-1')
  assert.deepEqual(await starts.get(), { states: { 'DIOGEN-449': linked }, hidden: [] })
  await starts.hide('DIOGEN-449')
  assert.deepEqual(posts.at(-1), { event: 'start.changed', payload: { key: 'DIOGEN-449', state: linked, hidden: true } })
  assert.deepEqual(await starts.get(), { states: { 'DIOGEN-449': linked }, hidden: ['DIOGEN-449'] })

  const again = new Starts(f.orca, new Connections(f.orca), items)
  assert.deepEqual(await again.get(), { states: { 'DIOGEN-449': linked }, hidden: ['DIOGEN-449'] })
  assert.deepEqual(await again.start(START), { accepted: false, reason: 'This item already has a workspace: open it instead.' })
  assert.equal(f.counts['workspace.create'], undefined)

  // The workspace is removed in Orca: the link and the hiding end together.
  rows = []
  assert.deepEqual(await again.get(), { states: {}, hidden: [] })
  assert.deepEqual(f.storage.get(keyOf(await oldId(), 'hidden')), [])
  assert.deepEqual(posts.at(-1), { event: 'start.changed', payload: { key: 'DIOGEN-449', state: { kind: 'idle' }, hidden: false } })
})
