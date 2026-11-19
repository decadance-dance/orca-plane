// `orca plugin check` renders the panel once per scenario. `requests` stand in for the worker,
// so no scenario reaches a Plane server.
import { defineCheck } from 'orca/testing'
import type { Item, ItemDetail } from './plane/map'
import type { Attempt, ItemsState, LinkView, StartState } from './protocol'

const CONNECTED = { connected: true, hostKind: 'cloud', server: 'https://app.plane.so', slug: 'acme', userName: 'Ada' } as const
const now = Date.now()

const row = (
  key: string,
  title: string,
  stateGroup: Item['stateGroup'],
  stateName: string | null,
  priority: Item['priority'],
  labels: string[]
): Item => ({
  id: key,
  key,
  title,
  projectId: `project-${key.split('-')[0]}`,
  stateName,
  stateGroup,
  priority,
  labels,
  updatedAt: '2026-11-16T12:00:00Z'
})
const ITEMS = [
  row('WEB-12', 'Fix the login redirect', 'started', 'In Progress', 'high', ['bug', 'auth']),
  row('WEB-9', 'Add a dark mode toggle', 'unstarted', 'Todo', 'medium', ['ui']),
  row('API-3', 'Paginate the audit log', 'unstarted', 'Todo', 'low', []),
  row('API-1', 'Rate limit the export endpoint', 'backlog', 'Backlog', 'urgent', ['auth']),
  row('OPS-4', 'Rotate the staging certificates', 'unknown', null, 'none', [])
]
const DETAIL: ItemDetail = {
  ...ITEMS[0],
  assignees: ['Ada'],
  description:
    '## Problem\n\nAfter signing in, users land on the **home page** instead of the page they asked for.\n\n' +
    '## Steps\n\n1. Open `/settings` while signed out.\n2. Sign in.\n\n- [x] Reproduced\n- [ ] Fixed\n\nSee [the login flow](https://example.com/login).',
  url: 'https://app.plane.so/acme/browse/WEB-12/'
}

const state = (over: Partial<ItemsState>): ItemsState => ({
  items: ITEMS,
  completeness: 'complete',
  fetchedAt: now - 120_000,
  error: null,
  refreshing: false,
  ...over
})

const connected = (
  list: ItemsState,
  starts: Record<string, StartState> = {},
  links: Record<string, LinkView> = {},
  history: Attempt[] = []
) => ({
  requests: {
    'connection.get': CONNECTED,
    'items.list': list,
    'starts.get': { states: starts, hidden: [] },
    'links.get': links,
    'history.get': history,
    'item.get': { ok: true as const, item: DETAIL },
    'orca.projects': { projects: [{ id: 'p1', name: 'web-app', hostId: 'local' }] },
    'agents.installed': { agents: [{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }] }
  }
})
const onDetail = { persisted: { plugin: { 'plane.open': { key: 'WEB-12', projectId: 'project-WEB' } } } }
const persisted = (plugin: Record<string, unknown>) => ({ persisted: { plugin } }) as const

// The first tab (API) shows each row decoration: a linked workspace whose agent works, and a failed Start.
const LINKED: Record<string, StartState> = {
  'API-3': { kind: 'created', workspaceId: 'w3', name: 'API-3-paginate-the-audit-log', projectId: 'p1' },
  'API-1': { kind: 'failed', error: 'Orca could not create the worktree.' },
  'WEB-9': { kind: 'created', workspaceId: 'w1', name: 'WEB-9-add-a-dark-mode-toggle', projectId: 'p1' },
  'WEB-12': { kind: 'created', workspaceId: 'w2', name: 'WEB-12-fix-the-login-redirect', projectId: 'p1' }
}
const AGENTS: Record<string, LinkView> = {
  'API-3': { workspaceId: 'w3', agent: 'working' },
  'WEB-9': { workspaceId: 'w1', agent: 'needs-input' },
  'WEB-12': { workspaceId: 'w2', agent: 'done' }
}
const attempt = (id: string, agent: string | null, outcome: Attempt['outcome'], ago: number): Attempt => ({
  id,
  at: now - ago,
  agent,
  project: 'web-app',
  projectId: 'p1',
  workspace: 'WEB-12-fix-the-login-redirect',
  outcome
})
// Settled, as the worker returns it once `starts.get` has reconciled the history with the linked workspace.
const HISTORY = [attempt('a1', 'codex', 'failed', 86_400_000), attempt('a2', 'claude', 'created', 600_000)]

export default defineCheck({
  disconnected: { requests: { 'connection.get': { connected: false } } },
  loading: connected(state({ items: [], completeness: null, fetchedAt: null, refreshing: true })),
  complete: connected(state({}), LINKED, AGENTS),
  // The WEB project's tab (the third of API, OPS, WEB), with the agent badges of its linked items.
  'web-tab': { ...connected(state({}), LINKED, AGENTS), ...persisted({ 'plane.tab': 'project-WEB' }) },
  // An active tag filter is filled with its tone; an item must carry every active tag.
  tags: { ...connected(state({})), ...persisted({ 'plane.tags': ['label:auth'] }) },
  // DOC-7 left the list; its workspace shows in the section of items no longer open.
  leftovers: connected(state({}), { 'DOC-7': { kind: 'created', workspaceId: 'w7', name: 'DOC-7-update-the-api-guide', projectId: 'p1' } }),
  partial: connected(state({ completeness: 'partial', error: 'More than 1000 items: only the newest are shown.' })),
  stale: connected(state({ completeness: 'stale', error: 'Plane answered HTTP 502' })),
  empty: connected(state({ items: [] })),
  error: connected(state({ items: [], completeness: 'error', fetchedAt: null, error: 'Could not reach the Plane server.' })),
  search: { ...connected(state({})), ...persisted({ 'plane.search': 'auth' }) },
  'search-none': { ...connected(state({})), ...persisted({ 'plane.search': 'billing' }) },
  confirm: { ...connected(state({})), ...persisted({ 'plane.confirm': { key: 'WEB-12', projectId: 'project-WEB' }, 'plane.tab': 'project-WEB' }) },
  // The prompt built from the promptTemplate setting, with the Terminal only agent chosen.
  'confirm-template': {
    ...connected(state({})),
    settings: { promptTemplate: 'Fix {key} ({url}). Open a PR titled with {key}.\n\n{ticket}' },
    ...persisted({ 'plane.confirm': { key: 'WEB-12', projectId: 'project-WEB' }, 'plane.tab': 'project-WEB', 'plane.agent': 'none' })
  },
  detail: { ...connected(state({})), ...onDetail },
  // A linked item: its agent badge, Open workspace and its earlier Starts.
  'detail-linked': { ...connected(state({}), LINKED, AGENTS, HISTORY), ...onDetail },
  // Orca created the workspace but the agent did not start: the link stands with no agent state, and the attempt failed.
  'start-failed': {
    ...connected(
      state({}),
      { 'WEB-12': { kind: 'failed', error: 'The agent did not answer.', workspaceId: 'w2', name: 'WEB-12-fix-the-login-redirect' } },
      { 'WEB-12': { workspaceId: 'w2', agent: null } },
      [attempt('a1', 'claude', 'failed', 60_000)]
    ),
    ...onDetail
  },
  // The worker writes the pending attempt before it publishes the pending state; both carry the same time.
  'start-pending': {
    ...connected(
      state({}),
      { 'WEB-12': { kind: 'pending', name: 'WEB-12-fix-the-login-redirect', projectId: 'p1', startedAt: now } },
      {},
      [attempt('a1', 'claude', 'pending', 0)]
    ),
    ...onDetail
  },
  // A create whose outcome Orca has not shown yet: its attempt is not confirmed.
  'start-unknown': {
    ...connected(
      state({}),
      { 'WEB-12': { kind: 'unknown', name: 'WEB-12-fix-the-login-redirect', projectId: 'p1' } },
      {},
      [attempt('a1', null, 'unknown', 120_000)]
    ),
    ...onDetail
  }
})
