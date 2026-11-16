// `orca plugin check` renders the panel once per scenario. `requests` stand in for the worker,
// so no scenario reaches a Plane server.
import { defineCheck } from 'orca/testing'
import type { Item, ItemDetail } from './plane/map'
import type { ItemsState, StartState } from './protocol'

const CONNECTED = { connected: true, hostKind: 'cloud', server: 'https://app.plane.so', slug: 'acme', userName: 'Ada' } as const
const now = Date.now()

const row = (key: string, title: string, stateGroup: Item['stateGroup'], stateName: string | null): Item => ({
  id: key,
  key,
  title,
  projectId: 'plane-project',
  stateName,
  stateGroup,
  priority: 'medium',
  updatedAt: '2026-11-16T12:00:00Z'
})
const ITEMS = [
  row('WEB-12', 'Fix the login redirect', 'started', 'In Progress'),
  row('WEB-9', 'Add a dark mode toggle', 'unstarted', 'Todo'),
  row('API-3', 'Paginate the audit log', 'unstarted', 'Todo'),
  row('API-1', 'Rate limit the export endpoint', 'backlog', 'Backlog'),
  row('OPS-4', 'Rotate the staging certificates', 'unknown', null)
]
const DETAIL: ItemDetail = {
  ...ITEMS[0],
  assignees: ['Ada'],
  labels: ['bug', 'auth'],
  description: 'After signing in, users land on the home page instead of the page they asked for.\n\nKeep the original URL through the login flow.',
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

const connected = (list: ItemsState, starts: Record<string, StartState> = {}) => ({
  requests: {
    'connection.get': CONNECTED,
    'items.list': list,
    'starts.get': starts,
    'item.get': { ok: true as const, item: DETAIL },
    'orca.projects': { projects: [{ id: 'p1', name: 'web-app', hostId: 'local' }] }
  }
})
const onDetail = { persisted: { plugin: { 'plane.open': { key: 'WEB-12', projectId: 'plane-project' } } } }

export default defineCheck({
  disconnected: { requests: { 'connection.get': { connected: false } } },
  loading: connected(state({ items: [], completeness: null, fetchedAt: null, refreshing: true })),
  complete: connected(state({}), { 'WEB-9': { kind: 'created', workspaceId: 'w1', name: 'WEB-9-add-a-dark-mode-toggle', projectId: 'p1' } }),
  partial: connected(state({ completeness: 'partial', error: 'More than 1000 items: only the newest are shown.' })),
  stale: connected(state({ completeness: 'stale', error: 'Plane answered HTTP 502' })),
  empty: connected(state({ items: [] })),
  error: connected(state({ items: [], completeness: 'error', fetchedAt: null, error: 'Could not reach the Plane server.' })),
  detail: { ...connected(state({})), ...onDetail },
  'start-pending': {
    ...connected(state({}), { 'WEB-12': { kind: 'pending', name: 'WEB-12-fix-the-login-redirect', projectId: 'p1', startedAt: now } }),
    ...onDetail
  },
  'start-unknown': {
    ...connected(state({}), { 'WEB-12': { kind: 'unknown', name: 'WEB-12-fix-the-login-redirect', projectId: 'p1' } }),
    ...onDetail
  }
})
