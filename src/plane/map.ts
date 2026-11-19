// Maps Plane API v2 payloads (rows with `expand=state,assignees,labels`, a detail also `parent`) to the plugin's model.
import { htmlToMarkdown } from './markdown'

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
  /** From `expand=parent`; null without a parent or when Plane did not send a readable one (design A5). */
  parent?: { key: string | null; title: string } | null
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
  const parent = row.parent && typeof row.parent === 'object' ? (row.parent as Row) : null
  return {
    ...item,
    assignees: names(row.assignees, 'display_name'),
    description: htmlToMarkdown(str(row.description_html)),
    url: url(item.key),
    // The expanded parent has no project, so its key prefix is unknown: the title alone.
    parent: parent && str(parent.name) ? { key: null, title: str(parent.name) } : null
  }
}
