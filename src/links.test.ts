// The Links model (design L1, L2, L4) on its own, and the ids of the live probe.
import { assert, test } from 'orca/testing'
import probe from '../test/fixtures/orca-ids.json' with { type: 'json' }
import { Links } from './links'
import type { LinkView, StartState } from './protocol'

const created = (workspaceId: string): StartState => ({ kind: 'created', workspaceId, name: 'n', projectId: 'p1' })

function links(states: Record<string, StartState> = {}) {
  const changes: { links: Record<string, LinkView>; waiting: number }[] = []
  const focus: (string | null)[] = []
  const model = new Links({ changed: (all, waiting) => changes.push({ links: all, waiting }), focus: (key) => focus.push(key) })
  model.set(states)
  return { model, changes, focus }
}

const status = (over: Record<string, unknown> = {}) => ({
  workspaceId: 'w1',
  paneKey: 'pane',
  state: 'working' as const,
  receivedAt: 1000,
  ...over
})

const context = (workspaceId?: string, branch = 'main') => ({
  context: { ...(workspaceId ? { workspaceId } : {}), branch, displayName: branch, terminals: [] }
})

test('the live probe: workspace.create, workspace.list, focus and every event but the launch hook carry one shared id', () => {
  const records = probe.records as { source: string; payload: Record<string, unknown> }[]
  const carried = (source: string) =>
    records
      .filter((record) => record.source === source)
      .map(({ payload }) => {
        const context = payload.context as { workspaceId?: string } | undefined
        const rows = payload.rows as { id: string }[] | undefined
        return [payload.workspaceListId, payload.workspaceId, context?.workspaceId, rows?.[0]?.id]
      })
  for (const source of ['workspace.list.rows', 'workspace.created', 'agent.status.changed', 'workspace.removed']) {
    for (const ids of carried(source)) assert.ok(ids.includes(probe.returnedId), source)
  }
  assert.ok(carried('workspace.changed').some((ids) => ids.includes(probe.returnedId)))
  // limit: agent.launch.before names the workspace only by the `<project>::<path>` form, not the returned id.
  assert.ok(!carried('agent.launch.before')[0].includes(probe.returnedId))
  // The events' own workspaceId is that other form; workspaceListId is the returned id.
  const removed = records.find((record) => record.source === 'workspace.removed')!.payload
  assert.notEqual(removed.workspaceId, probe.returnedId)
  // The probe's agent events, replayed against a link to the returned id, reach its row.
  const { model } = links({ 'DIOGEN-449': created(probe.returnedId) })
  for (const record of records) {
    if (record.source === 'agent.status.changed') model.agent(record.payload as never)
  }
  assert.deepEqual(model.byKey(), { 'DIOGEN-449': { workspaceId: probe.returnedId, agent: 'done' } })
})

test('links come from created states and from failed states that name a workspace', () => {
  const { model } = links({
    A: created('w1'),
    B: { kind: 'failed', error: 'agent crashed', workspaceId: 'w2' },
    C: { kind: 'failed', error: 'refused' },
    D: { kind: 'pending', name: 'n', projectId: 'p1', startedAt: 1 },
    E: { kind: 'unknown', name: 'n', projectId: 'p1' }
  })
  assert.deepEqual(model.byKey(), { A: { workspaceId: 'w1', agent: null }, B: { workspaceId: 'w2', agent: null } })
  assert.equal(model.keyOfWorkspace('w2'), 'B')
  assert.equal(model.keyOfWorkspace('w9'), null)
})

test('an event matches its link by either id it carries', () => {
  const { model } = links({ A: created('list-1'), B: created('w2') })
  // The stored id as workspaceListId, with a different workspaceId.
  model.agent(status({ workspaceId: 'p1::/a', workspaceListId: 'list-1', state: 'done' }))
  // The stored id as workspaceId, with a different workspaceListId.
  model.agent(status({ workspaceId: 'w2', workspaceListId: 'other', state: 'waiting' }))
  assert.deepEqual(model.byKey(), {
    A: { workspaceId: 'list-1', agent: 'done' },
    B: { workspaceId: 'w2', agent: 'needs-input' }
  })
})

test('unlinked events and events without an id change no link', () => {
  const { model, changes } = links({ A: created('w1') })
  const before = changes.length
  model.agent(status({ workspaceId: 'w9', state: 'waiting' }))
  model.agent(status({ workspaceId: null, state: 'waiting' }))
  assert.equal(changes.length, before)
  assert.deepEqual(model.byKey(), { A: { workspaceId: 'w1', agent: null } })
})

test('a state reported before the link exists shows once the link appears', () => {
  const { model } = links()
  model.agent(status({ workspaceId: 'w1', state: 'working' }))
  model.set({ A: created('w1') })
  assert.deepEqual(model.byKey(), { A: { workspaceId: 'w1', agent: 'working' } })
})

test('the main agent wins over a sub-pane; blocked and waiting both need input', () => {
  const { model } = links({ A: created('w1') })
  model.agent(status({ state: 'working', mainAgent: { state: 'blocked', stateStartedAt: 900 } }))
  assert.equal(model.byKey().A.agent, 'needs-input')
  model.agent(status({ state: 'waiting', mainAgent: { state: 'working', stateStartedAt: 950 } }))
  assert.equal(model.byKey().A.agent, 'working')
  model.agent(status({ state: 'waiting' }))
  assert.equal(model.byKey().A.agent, 'needs-input')
})

test('since is kept across repeated waiting events; the waiting order is longest first', () => {
  const { model, changes } = links({ A: created('w1'), B: created('w2'), C: created('w3') })
  model.agent(status({ workspaceId: 'w2', state: 'waiting', receivedAt: 100 }))
  model.agent(status({ workspaceId: 'w1', state: 'blocked', mainAgent: { state: 'blocked', stateStartedAt: 200 } }))
  model.agent(status({ workspaceId: 'w2', state: 'blocked', receivedAt: 300 }))
  model.agent(status({ workspaceId: 'w2', state: 'waiting', receivedAt: 400 }))
  model.agent(status({ workspaceId: 'w3', state: 'working', receivedAt: 50 }))
  assert.deepEqual(model.waiting(), [
    { key: 'B', workspaceId: 'w2', since: 100 },
    { key: 'A', workspaceId: 'w1', since: 200 }
  ])
  assert.equal(changes.at(-1)?.waiting, 2)
  // Working again ends the run: the next wait starts a new since.
  model.agent(status({ workspaceId: 'w2', state: 'working', receivedAt: 500 }))
  model.agent(status({ workspaceId: 'w2', state: 'waiting', receivedAt: 600 }))
  assert.deepEqual(model.waiting().map(({ key, since }) => [key, since]), [['A', 200], ['B', 600]])
})

test('terminals map to their workspace, the linked id first', () => {
  const { model } = links({ A: created('list-1') })
  model.agent(status({ workspaceId: 'p1::/a', workspaceListId: 'list-1', terminalId: 't1' }))
  model.agent(status({ workspaceId: 'w9', terminalId: 't2' }))
  assert.equal(model.workspaceOfTerminal('t1'), 'list-1')
  assert.equal(model.workspaceOfTerminal('t2'), 'w9')
  assert.equal(model.workspaceOfTerminal('t3'), null)
})

test('a removed workspace loses its agent state at once', () => {
  const { model, changes } = links({ A: created('list-1') })
  model.agent(status({ workspaceId: 'p1::/a', workspaceListId: 'list-1', state: 'waiting', terminalId: 't1' }))
  assert.equal(changes.at(-1)?.waiting, 1)
  model.removed({ workspaceId: 'p1::/a', workspaceListId: 'list-1', kind: 'worktree', path: '/a' })
  assert.deepEqual(model.byKey(), { A: { workspaceId: 'list-1', agent: null } })
  assert.equal(changes.at(-1)?.waiting, 0)
  assert.equal(model.workspaceOfTerminal('t1'), null)
})

test('focus: the first event only sets it; then a linked id, an unlinked id, no id, and a repeat', () => {
  const { model, focus } = links({ A: created('w1'), B: created('w2') })
  model.focus(context('w1'))
  assert.deepEqual(focus, [])
  model.focus(context('w2'))
  assert.deepEqual(focus, ['B'])
  model.focus(context('w2'))
  assert.deepEqual(focus, ['B'])
  // Another repository's workspace on the same branch is not linked.
  model.focus(context('w7', 'main'))
  assert.deepEqual(focus, ['B', null])
  model.focus(context('w1'))
  model.focus(context(undefined))
  model.focus({ context: null })
  assert.deepEqual(focus, ['B', null, 'A', null])
})

test("review 4: after an account switch, the same key linked to another workspace is followed", () => {
  const { model, focus } = links({ 'DIOGEN-449': created('wA') })
  model.focus(context('w0'))
  model.focus(context('wA'))
  assert.deepEqual(focus, ['DIOGEN-449'])
  model.clear()
  model.set({ 'DIOGEN-449': created('wB') })
  model.focus(context('wB'))
  assert.deepEqual(focus, ['DIOGEN-449', 'DIOGEN-449'])
  // The same-workspace guard still holds.
  model.focus(context('wB'))
  assert.deepEqual(focus, ['DIOGEN-449', 'DIOGEN-449'])
})

// --- agent-item-context: the item of a terminal or a launch (A1, A3, A4) ---

const CLOUD = { appBase: 'https://app.plane.so', slug: 'truelogic' }
const url = (key: string) => `https://app.plane.so/truelogic/browse/${key}/`
const records = probe.records as { source: string; payload: Record<string, unknown> }[]
const record = (source: string) => records.find((entry) => entry.source === source)!.payload
const launch = record('agent.launch.before') as { workspaceId: string; terminalId: string }

/** A host whose terminal.list and workspace.list answer from `terminals` and `rows`. */
function seedHost(terminals: Record<string, string[]>, rows: unknown[] = []) {
  const calls: string[] = []
  return {
    calls,
    host: {
      call: async (method: string, params?: { workspaceId: string }) => {
        calls.push(params ? `${method} ${params.workspaceId}` : method)
        if (method === 'workspace.list') return { workspaces: rows, truncated: false }
        if (!(params!.workspaceId in terminals)) throw new Error('no such workspace')
        return { terminals: terminals[params!.workspaceId].map((id) => ({ id })), truncated: false }
      }
    } as never
  }
}

test('each source maps a terminal to its workspace: status, launch, focus, terminal.list and the create handoff', async () => {
  const { model } = links({ A: created('list-1'), B: created('list-2'), C: created('list-3') })
  model.connection(CLOUD)
  model.agent(status({ workspaceId: 'p1::/a', workspaceListId: 'list-1', terminalId: 't-status' }))
  model.launch({ workspaceId: 'list-1', terminalId: 't-launch' })
  model.focus({ context: { workspaceId: 'list-2', branch: 'b', displayName: 'b', terminals: [{ id: 't-focus' }] } })
  const { host, calls } = seedHost({ 'list-1': [], 'list-2': [], 'list-3': ['t-listed'], 'list-4': [] })
  await model.seed(host)
  model.adopt('D', 'list-4', 't-created')
  assert.deepEqual(
    ['t-status', 't-launch', 't-focus', 't-listed', 't-created'].map((t) => model.itemOfTerminal(t)?.key),
    ['A', 'A', 'B', 'C', 'D']
  )
  assert.deepEqual(model.itemOfTerminal('t-status'), { key: 'A', url: url('A') })
  // Each linked workspace is listed once; a later seed lists only new ones (a failed list is retried).
  assert.deepEqual(calls.filter((call) => call.startsWith('terminal.list')).sort(), ['terminal.list list-1', 'terminal.list list-2', 'terminal.list list-3'])
  await model.seed(host)
  assert.deepEqual(calls.slice(4), ['workspace.list', 'terminal.list list-4'])
})

test('a terminal never reported, an unlinked workspace, or no connection: no item', () => {
  const { model } = links({ A: created('list-1') })
  model.agent(status({ workspaceId: 'w9', terminalId: 't9' }))
  assert.equal(model.itemOfTerminal('t9'), null)
  model.agent(status({ workspaceId: 'list-1', terminalId: 't1' }))
  assert.equal(model.itemOfTerminal('t1'), null, 'no connection yet: no URL to give')
  model.connection(CLOUD)
  assert.equal(model.itemOfTerminal('t-unseen'), null)
  assert.equal(model.itemOfTerminal('t1')?.key, 'A')
})

test('no link by name: a created workspace with the item name and branch links nothing', () => {
  const { model } = links({ A: { kind: 'pending', name: 'A-1-x', projectId: 'p1', startedAt: 1 } })
  model.connection(CLOUD)
  model.created({ workspaceId: 'p1::/A-1-x', workspaceListId: 'list-9', kind: 'worktree', path: '/A-1-x', branch: 'A-1-x' })
  assert.equal(model.launch({ workspaceId: 'p1::/A-1-x', terminalId: 't1' }), null)
  assert.equal(model.itemOfTerminal('t1'), null)
})

test('URLs keep a self-hosted path prefix', () => {
  const { model } = links({ 'WEB-12': created('list-1') })
  model.connection({ appBase: 'https://plane.example.org/tools/plane', slug: 'my team' })
  assert.equal(model.launch({ workspaceId: 'list-1' })?.url, 'https://plane.example.org/tools/plane/my%20team/browse/WEB-12/')
})

test('the live probe: the launch hook resolves by the id pair of workspace.created', () => {
  const { model } = links()
  model.connection(CLOUD)
  // In the probe the first launch comes before the create returns: no item yet.
  assert.equal(model.launch(launch), null)
  model.created(record('workspace.created') as never)
  model.adopt('DIOGEN-449', probe.returnedId)
  assert.equal(model.launch({ ...launch, terminalId: 'new-tab' })?.key, 'DIOGEN-449')
  assert.equal(model.itemOfTerminal(launch.terminalId)?.key, 'DIOGEN-449')
})

test('the live probe: the launch hook resolves by a workspace.list row; a row without projectId or path adds nothing', async () => {
  const row = (record('workspace.list.rows').rows as Record<string, unknown>[])[0]
  for (const [rows, found] of [
    [[row], 'DIOGEN-449'],
    [[{ ...row, projectId: null }], undefined],
    [[{ ...row, path: '' }], undefined],
    [[{ ...row, path: `${row.path}-other` }], undefined]
  ] as const) {
    const { model } = links({ 'DIOGEN-449': created(probe.returnedId) })
    model.connection(CLOUD)
    await model.seed(seedHost({ [probe.returnedId]: [] }, [...rows]).host)
    assert.equal(model.launch({ ...launch, terminalId: 'new-tab' })?.key, found)
  }
})

test('a handed-over link lasts while the Start is pending, then the stored state decides', () => {
  const pending: StartState = { kind: 'pending', name: 'n', projectId: 'p1', startedAt: 1 }
  const { model } = links({ A: pending })
  model.connection(CLOUD)
  model.adopt('A', 'list-1', 't1')
  model.set({ A: pending })
  assert.equal(model.itemOfTerminal('t1')?.key, 'A')
  model.set({ A: { kind: 'unknown', name: 'n', projectId: 'p1' } })
  assert.equal(model.itemOfTerminal('t1'), null)
  model.adopt('A', 'list-1', 't1')
  model.clear()
  assert.equal(model.itemOfTerminal('t1'), null)
})

test('a removed workspace drops its id pair, its terminals and a handed-over link', () => {
  const { model } = links()
  model.connection(CLOUD)
  model.created({ workspaceId: 'p1::/a', workspaceListId: 'list-1', kind: 'worktree', path: '/a', branch: 'a' })
  model.adopt('A', 'list-1', 't1')
  model.removed({ workspaceId: 'p1::/a', workspaceListId: 'list-1', kind: 'worktree', path: '/a' })
  assert.equal(model.launch({ workspaceId: 'p1::/a', terminalId: 't2' }), null)
  assert.equal(model.itemOfTerminal('t1'), null)
})

test('review 1: a workspace.list snapshot that answers after a removal links neither the old item nor a replacement at the same path', async () => {
  const row = (record('workspace.list.rows').rows as Record<string, unknown>[])[0]
  for (const replaced of [true, false]) {
    const { model } = links({ 'OLD-1': created(probe.returnedId) })
    model.connection(CLOUD)
    let answer!: (rows: unknown) => void
    const held = new Promise((resolve) => (answer = resolve))
    const host = {
      call: async (method: string) =>
        method === 'workspace.list' ? { workspaces: await held, truncated: false } : { terminals: [], truncated: false }
    } as never
    const seeding = model.seed(host)
    // Orca removes the workspace; the Start state still links it until its removal is written.
    model.removed(record('workspace.removed') as never)
    if (replaced) model.created({ workspaceId: launch.workspaceId, workspaceListId: 'replacement', kind: 'worktree', path: '/x', branch: 'x' })
    assert.equal(model.launch({ ...launch, terminalId: 't-new' }), null)
    answer([row])
    await seeding
    assert.equal(model.launch({ ...launch, terminalId: 't-new' }), null, `replaced: ${replaced}`)
    assert.equal(model.itemOfTerminal('t-new'), null)
  }
})

test('review 3: a failed workspace.list is retried by the next seed', async () => {
  const row = (record('workspace.list.rows').rows as Record<string, unknown>[])[0]
  const { model } = links({ 'DIOGEN-449': created(probe.returnedId) })
  model.connection(CLOUD)
  let lists = 0
  const host = {
    call: async (method: string) => {
      if (method !== 'workspace.list') return { terminals: [], truncated: false }
      if (++lists === 1) throw new Error('host busy')
      return { workspaces: [row], truncated: false }
    }
  } as never
  await model.seed(host)
  assert.equal(model.launch({ ...launch, terminalId: 'new-tab' }), null)
  await model.seed(host)
  assert.equal(model.launch({ ...launch, terminalId: 'new-tab' })?.key, 'DIOGEN-449')
})

test('review round 2: a removal without workspaceListId still wins over a list sent before it', async () => {
  const row = (record('workspace.list.rows').rows as Record<string, unknown>[])[0]
  const removed = { ...(record('workspace.removed') as Record<string, unknown>) }
  delete removed.workspaceListId
  // primed: the pair was known from workspace.created; replaced: the replacement reports itself (path id only) before the list lands.
  for (const [primed, replaced] of [[true, false], [true, true], [false, false], [false, true]]) {
    const { model } = links({ 'OLD-1': created(probe.returnedId) })
    model.connection(CLOUD)
    if (primed) model.created(record('workspace.created') as never)
    let answer!: (rows: unknown) => void
    const held = new Promise((resolve) => (answer = resolve))
    const host = {
      call: async (method: string) =>
        method === 'workspace.list' ? { workspaces: await held, truncated: false } : { terminals: [], truncated: false }
    } as never
    const seeding = model.seed(host)
    model.removed(removed as never)
    if (replaced) model.created({ workspaceId: launch.workspaceId, kind: 'worktree', path: '/x', branch: 'x' })
    answer([row])
    await seeding
    assert.equal(model.launch({ ...launch, terminalId: 't-new' }), null, `primed: ${primed}, replaced: ${replaced}`)
    assert.equal(model.itemOfTerminal('t-new'), null)
  }
})

// Round 3: once a `<projectId>::<path>` form is removed, only a later workspace.created pairs it again (design A4).
const pathOnlyRemoval = () => {
  const removed = { ...(record('workspace.removed') as Record<string, unknown>) }
  delete removed.workspaceListId
  return removed as never
}
const oldStatus = () => ({ ...(records.find((entry) => entry.source === 'agent.status.changed')!.payload as Record<string, unknown>) }) as never

test('review round 3: a late agent status of the removed workspace does not pair its path again', async () => {
  const row = (record('workspace.list.rows').rows as Record<string, unknown>[])[0]
  for (const order of ['created after launch', 'created before list, path id only']) {
    const { model } = links({ 'OLD-1': created(probe.returnedId) })
    model.connection(CLOUD)
    let answer!: (rows: unknown) => void
    const held = new Promise((resolve) => (answer = resolve))
    const host = {
      call: async (method: string) =>
        method === 'workspace.list' ? { workspaces: await held, truncated: false } : { terminals: [], truncated: false }
    } as never
    const seeding = model.seed(host)
    model.removed(pathOnlyRemoval())
    if (order !== 'created after launch') model.created({ workspaceId: launch.workspaceId, kind: 'worktree', path: '/x', branch: 'x' })
    answer([row])
    await seeding
    model.agent(oldStatus())
    assert.equal(model.launch({ ...launch, terminalId: 't-new' }), null, order)
    assert.equal(model.itemOfTerminal('t-new'), null, order)
    if (order === 'created after launch') model.created({ workspaceId: launch.workspaceId, kind: 'worktree', path: '/x', branch: 'x' })
    assert.equal(model.itemOfTerminal('t-new'), null, order)
  }
})

test('review round 3: after a path-only removal, agent status and list rows do not pair the path; a later workspace.created does', async () => {
  const row = (record('workspace.list.rows').rows as Record<string, unknown>[])[0]
  const seedHostWith = (rows: unknown[]) => ({ call: async (method: string) => (method === 'workspace.list' ? { workspaces: rows, truncated: false } : { terminals: [], truncated: false }) }) as never
  // agent.status.changed
  let { model } = links({ 'OLD-1': created(probe.returnedId) })
  model.connection(CLOUD)
  model.removed(pathOnlyRemoval())
  model.agent(oldStatus())
  assert.equal(model.launch({ ...launch, terminalId: 't-a' }), null, 'agent.status')
  // a list seed asked after the removal
  ;({ model } = links({ 'OLD-1': created(probe.returnedId) }))
  model.connection(CLOUD)
  model.removed(pathOnlyRemoval())
  await model.seed(seedHostWith([row]))
  assert.equal(model.launch({ ...launch, terminalId: 't-b' }), null, 'list seed')
  // a workspace.created after the removal pairs the path with the replacement's id
  ;({ model } = links({ 'OLD-1': created(probe.returnedId), 'NEW-1': created('replacement') }))
  model.connection(CLOUD)
  model.removed(pathOnlyRemoval())
  model.created({ workspaceId: launch.workspaceId, workspaceListId: 'replacement', kind: 'worktree', path: '/x', branch: 'x' })
  model.agent(oldStatus())
  await model.seed(seedHostWith([row]))
  assert.equal(model.launch({ ...launch, terminalId: 't-c' })?.key, 'NEW-1', 'created')
})

test('review round 4: a worktree without an identity id is removed under its raw path id in both fields', () => {
  // Orca falls back to `<projectId>::<path>` for the id `workspace.create` returns, so the Start link is stored under it.
  const raw = launch.workspaceId
  const seen: Record<string, (string | undefined)[]> = {}
  for (const order of ['launch before its create', 'launch after its create']) {
    const { model } = links({ 'OLD-1': created(raw), 'NEW-1': created('new-stable') })
    model.connection(CLOUD)
    model.removed({ workspaceId: raw, workspaceListId: raw, kind: 'worktree', path: '/x' })
    const after = order === 'launch after its create'
    if (after) model.created({ workspaceId: raw, workspaceListId: 'new-stable', kind: 'worktree', path: '/x', branch: 'x' })
    seen[order] = [model.launch({ workspaceId: raw, terminalId: 't-new' })?.key, model.itemOfTerminal('t-new')?.key]
  }
  assert.deepEqual(seen, { 'launch before its create': [undefined, undefined], 'launch after its create': ['NEW-1', 'NEW-1'] })
})
