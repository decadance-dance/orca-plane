// Races between the connection and Start, driven by hand over a fake host whose replies the test holds.
import type { OrcaWorkerApi } from 'orca/worker'
import { assert, hostError, test } from 'orca/testing'
import page from '../test/fixtures/v2-list-page.json' with { type: 'json' }
import { Connections, connectionId, keyOf } from './connection'
import type { Items } from './items'
import { fakeFetch } from './plane/fake-fetch'
import { Starts } from './starts'

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
      set: async (key: string, value: unknown) => void storage.set(key, value),
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
  assert.deepEqual(await starts.all(), {})
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
