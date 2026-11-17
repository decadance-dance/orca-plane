import { assert, test } from 'orca/testing'
import { getItem, listMyOpenItems, me } from './api'
import { type FakeAnswer, fakeFetch } from './fake-fetch'
import { PlaneError } from './http'

const conn = { apiBase: 'https://api.plane.so', token: 'plane_api_test' }
const USER = 'd9371857-5d13-4306-abe9-f3aefb05f40e'
const rows = (page: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${page}-${i}` }))

/** Pages keyed by the cursor they answer (`''` is the first). */
function pager(pages: Record<string, FakeAnswer>) {
  return fakeFetch((url) => pages[url.searchParams.get('cursor') ?? ''] ?? { status: 500 })
}

test('me() reads id and display name; 404 means no v2', async () => {
  fakeFetch(() => ({ json: { id: USER, display_name: 'Dima' } }))
  assert.deepEqual(await me(conn), { id: USER, displayName: 'Dima' })
  fakeFetch(() => ({ status: 404, json: { error: 'x' } }))
  await assert.rejects(me(conn), (e: unknown) => e instanceof PlaneError && e.kind === 'unsupported_server')
})

test('every page repeats the filters, order and page size (design D1)', async () => {
  const fake = pager({
    '': { json: { data: rows(1, 200), has_more: true, next_cursor: 'c2' } },
    c2: { json: { data: rows(2, 3), has_more: false, next_cursor: null } }
  })
  const result = await listMyOpenItems(conn, 'truelogic', USER)
  assert.equal(result.completeness, 'complete')
  assert.equal(result.rows.length, 203)
  assert.equal(fake.calls.length, 2)
  for (const [i, call] of fake.calls.entries()) {
    const url = new URL(call.url)
    assert.equal(url.pathname, '/api/v2/workspaces/truelogic/work-items/')
    const query = Object.fromEntries(url.searchParams)
    assert.deepEqual(query, {
      assignee_id: USER,
      state_group__in: 'backlog,unstarted,started',
      expand: 'state,assignees,labels',
      order_by: '-updated_at',
      paginate: 'cursor',
      per_page: '200',
      ...(i === 1 ? { cursor: 'c2' } : {})
    })
  }
})

function fivePages(lastHasMore: boolean) {
  const pages: Record<string, FakeAnswer> = {}
  for (let p = 1; p <= 5; p++) {
    const has = p < 5 || lastHasMore
    pages[p === 1 ? '' : `c${p}`] = { json: { data: rows(p, 200), has_more: has, next_cursor: has ? `c${p + 1}` : null } }
  }
  return pages
}

test('exactly 1,000 items and no more is complete', async () => {
  pager(fivePages(false))
  const result = await listMyOpenItems(conn, 's', USER)
  assert.deepEqual([result.rows.length, result.completeness], [1000, 'complete'])
})

test('1,000 items with more on the server is partial', async () => {
  const fake = pager(fivePages(true))
  const result = await listMyOpenItems(conn, 's', USER)
  assert.deepEqual([result.rows.length, result.completeness], [1000, 'partial'])
  assert.equal(fake.calls.length, 5)
})

test('a repeated or malformed cursor is partial', async () => {
  for (const next of ['', null, 42]) {
    pager({ '': { json: { data: rows(1, 2), has_more: true, next_cursor: next } } })
    const result = await listMyOpenItems(conn, 's', USER)
    assert.deepEqual([result.rows.length, result.completeness], [2, 'partial'])
  }
  const fake = pager({
    '': { json: { data: rows(1, 2), has_more: true, next_cursor: 'a' } },
    a: { json: { data: rows(2, 2), has_more: true, next_cursor: 'a' } }
  })
  const result = await listMyOpenItems(conn, 's', USER)
  assert.deepEqual([result.rows.length, result.completeness], [4, 'partial'])
  assert.equal(fake.calls.length, 2)
})

test('a failing later page keeps the loaded items, partial with the error', async () => {
  pager({
    '': { json: { data: rows(1, 200), has_more: true, next_cursor: 'c2' } },
    c2: { status: 502, json: { detail: 'upstream down' } }
  })
  const result = await listMyOpenItems(conn, 's', USER)
  assert.equal(result.rows.length, 200)
  assert.equal(result.completeness, 'partial')
  assert.match(result.error ?? '', /upstream down/)
})

test('a failing first page throws', async () => {
  pager({ '': { status: 404, json: { error: 'The requested resource was not found.' } } })
  await assert.rejects(listMyOpenItems(conn, 's', USER), (e: unknown) => e instanceof PlaneError && e.kind === 'not_found')
})

test('getItem asks for one item by key in its project', async () => {
  const fake = fakeFetch(() => ({ json: { id: 'x' } }))
  await getItem(conn, 'truelogic', 'p-1', 'DIOGEN-449')
  const url = new URL(fake.calls[0].url)
  assert.equal(url.pathname, '/api/v2/workspaces/truelogic/projects/p-1/work-items/DIOGEN-449/')
  assert.equal(url.searchParams.get('expand'), 'state,assignees,labels')
})
