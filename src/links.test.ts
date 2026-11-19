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
