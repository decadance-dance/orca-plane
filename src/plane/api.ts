// Plane API v2 calls the plugin makes. All read-only.
import { type Conn, PlaneError, planeGet } from './http'

export const PER_PAGE = 200
export const MAX_PAGES = 5

const LIST_FILTERS = {
  state_group__in: 'backlog,unstarted,started',
  expand: 'state,assignees,labels',
  order_by: '-updated_at',
  paginate: 'cursor',
  per_page: String(PER_PAGE)
}

export type Me = { id: string; displayName: string }

/** A 404 here means no v2: `users/me` needs no slug. */
export async function me(conn: Conn, signal?: AbortSignal): Promise<Me> {
  let body: unknown
  try {
    body = await planeGet(conn, '/api/v2/users/me/', { signal })
  } catch (error) {
    if (error instanceof PlaneError && error.kind === 'not_found') {
      throw new PlaneError('unsupported_server', 'The server does not serve Plane API v2.', 404)
    }
    throw error
  }
  const record = (body ?? {}) as Record<string, unknown>
  if (typeof record.id !== 'string') throw new PlaneError('bad_response', 'Plane sent no user id.')
  const name = record.display_name ?? record.email
  return { id: record.id, displayName: typeof name === 'string' ? name : record.id }
}

export type ListResult = {
  rows: unknown[]
  completeness: 'complete' | 'partial'
  /** Why the list is partial when a page failed or paging broke. */
  error?: string
}

export type ListOptions = { signal?: AbortSignal; deadline?: number; maxPages?: number }

/** Walks cursor pages, repeating every filter on each: a cursor encodes only the position. */
export async function listMyOpenItems(
  conn: Conn,
  slug: string,
  userId: string,
  options: ListOptions = {}
): Promise<ListResult> {
  const path = `/api/v2/workspaces/${encodeURIComponent(slug)}/work-items/`
  const rows: unknown[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < (options.maxPages ?? MAX_PAGES); page++) {
    let body: Record<string, unknown>
    try {
      const query = { assignee_id: userId, ...LIST_FILTERS, ...(cursor ? { cursor } : {}) }
      body = ((await planeGet(conn, path, { query, signal: options.signal, deadline: options.deadline })) ??
        {}) as Record<string, unknown>
    } catch (error) {
      // Page 1 failing is the caller's error; a later page keeps what loaded.
      if (page === 0 || !(error instanceof PlaneError)) throw error
      return { rows, completeness: 'partial', error: error.message }
    }
    if (!Array.isArray(body.data)) {
      if (page === 0) throw new PlaneError('unsupported_server', 'The server did not answer as Plane API v2.')
      return { rows, completeness: 'partial', error: 'Plane sent a malformed page.' }
    }
    rows.push(...body.data)
    if (body.has_more !== true) return { rows, completeness: 'complete' }
    const next = body.next_cursor
    if (typeof next !== 'string' || !next || seen.has(next)) {
      return { rows, completeness: 'partial', error: 'Plane sent a repeated or malformed page cursor.' }
    }
    seen.add(next)
    cursor = next
  }
  return { rows, completeness: 'partial', error: `More than ${rows.length} items: only the newest are shown.` }
}

export async function getItem(
  conn: Conn,
  slug: string,
  projectId: string,
  key: string,
  signal?: AbortSignal
): Promise<unknown> {
  const path =
    `/api/v2/workspaces/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectId)}` +
    `/work-items/${encodeURIComponent(key)}/`
  return planeGet(conn, path, { query: { expand: LIST_FILTERS.expand }, signal })
}
