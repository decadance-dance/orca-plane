// Maps Plane API v2 payloads (rows with `expand=state,assignees,labels`) to the plugin's model.
import { htmlToText } from './html'

export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'unknown'
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export type Item = {
  id: string
  /** `KEY-N`, e.g. `DIOGEN-449`. */
  key: string
  title: string
  projectId: string
  /** null when Plane did not send the state's details. */
  stateName: string | null
  stateGroup: StateGroup
  priority: Priority
  /** Label names. */
  labels: string[]
  updatedAt: string
}

export type ItemDetail = Item & {
  assignees: string[]
  description: string
  url: string
}

const GROUPS = new Set<string>(['backlog', 'unstarted', 'started'])
const PRIORITIES = new Set<string>(['urgent', 'high', 'medium', 'low', 'none'])

type Row = Record<string, unknown>
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const names = (value: unknown, field: string): string[] =>
  Array.isArray(value)
    ? value.map((entry) => str((entry as Row | null)?.[field])).filter(Boolean)
    : []

/** null for a row without the fields an item needs. */
export function toItem(raw: unknown): Item | null {
  const row = (raw ?? {}) as Row
  const id = str(row.id)
  const key = str(row.identifier)
  if (!id || !key) return null
  const state = row.state && typeof row.state === 'object' ? (row.state as Row) : null
  const group = str(state?.group)
  const priority = str(row.priority)
  return {
    id,
    key,
    title: str(row.name),
    projectId: str(row.project_id),
    stateName: state ? str(state.name) || null : null,
    stateGroup: GROUPS.has(group) ? (group as StateGroup) : 'unknown',
    priority: PRIORITIES.has(priority) ? (priority as Priority) : 'none',
    labels: names(row.labels, 'name'),
    updatedAt: str(row.updated_at)
  }
}

export function toDetail(raw: unknown, url: (key: string) => string): ItemDetail | null {
  const item = toItem(raw)
  if (!item) return null
  const row = raw as Row
  return {
    ...item,
    assignees: names(row.assignees, 'display_name'),
    description: htmlToText(str(row.description_html)),
    url: url(item.key)
  }
}
