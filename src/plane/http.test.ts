import { assert, test } from 'orca/testing'
import { fakeFetch } from './fake-fetch'
import { env, PlaneError, planeGet } from './http'

const conn = { apiBase: 'https://api.plane.so', token: 'plane_api_SENTINEL' }

async function failure(promise: Promise<unknown>): Promise<PlaneError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof PlaneError)
    return error
  }
  assert.fail('expected a PlaneError')
}

test('sends the token in X-API-Key with JSON accept and no redirects', async () => {
  const fake = fakeFetch(() => ({ json: { ok: 1 } }))
  assert.deepEqual(await planeGet(conn, '/api/v2/users/me/', { query: { a: 'b c' } }), { ok: 1 })
  const { url, init } = fake.calls[0]
  assert.equal(url, 'https://api.plane.so/api/v2/users/me/?a=b+c')
  assert.deepEqual(init.headers, { 'X-API-Key': conn.token, Accept: 'application/json' })
  assert.equal(init.redirect, 'error')
})

test('refuses a URL off the connection origin before sending', async () => {
  const fake = fakeFetch(() => ({ json: {} }))
  const error = await failure(planeGet(conn, '@evil.example.com/x'))
  assert.equal(error.kind, 'bad_response')
  assert.equal(fake.calls.length, 0)
})

test('a redirect fails the request', async () => {
  fakeFetch((_url, init) => (init.redirect === 'error' ? new TypeError('redirect') : { json: {} }))
  assert.equal((await failure(planeGet(conn, '/x/'))).kind, 'network')
})

/** What undici's fetch rejects with: a TypeError whose cause carries the system or TLS code. */
function fetchFailed(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
}

test('a certificate the runtime does not trust is named, with its code', async () => {
  const codes = [
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID'
  ]
  for (const code of codes) {
    fakeFetch(() => fetchFailed(code))
    const error = await failure(planeGet(conn, '/x/'))
    assert.equal(error.kind, 'certificate', code)
    assert.equal(error.message, `The server's TLS certificate is not trusted (${code}).`)
    assert.ok(!error.message.includes(conn.token))
  }
})

test('a refused connection or an unknown failure stays a network error', async () => {
  for (const error of [fetchFailed('ECONNREFUSED'), fetchFailed('ENOTFOUND'), new TypeError('fetch failed')]) {
    fakeFetch(() => error)
    const failed = await failure(planeGet(conn, '/x/'))
    assert.equal(failed.kind, 'network')
    assert.equal(failed.message, 'Could not reach the Plane server.')
  }
})

test('classifies statuses and HTML', async () => {
  const cases: [number, string, string][] = [
    [401, '{"detail":"Invalid token"}', 'auth'],
    [403, '{}', 'forbidden'],
    [404, '{"error":"The requested resource was not found."}', 'not_found'],
    [500, '{}', 'bad_response'],
    [200, 'not json', 'bad_response'],
    [200, '<!doctype html><html></html>', 'unsupported_server']
  ]
  for (const [status, body, kind] of cases) {
    fakeFetch(() => ({ status, body }))
    const error = await failure(planeGet(conn, '/x/'))
    assert.equal(error.kind, kind, `${status} ${body}`)
  }
  fakeFetch(() => ({ status: 404, body: '<html>', headers: { 'content-type': 'text/html' } }))
  assert.equal((await failure(planeGet(conn, '/x/'))).kind, 'unsupported_server')
})

test('errors carry the server text but never the token or headers', async () => {
  fakeFetch(() => ({ status: 401, json: { detail: `bad key ${conn.token}` } }))
  const error = await failure(planeGet(conn, '/x/'))
  assert.equal(error.message, 'Plane refused the token: bad key ***')
  assert.ok(!JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes(conn.token))
})

test('timeout covers the body read', async () => {
  const saved = env.timeoutMs
  env.timeoutMs = 20
  fakeFetch(() => ({ json: {} }))
  const slowBody = env.fetch
  env.fetch = async (url, init) => {
    const response = await slowBody(url, init)
    const body = new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
      }
    })
    return new Response(body, { status: response.status, headers: response.headers })
  }
  try {
    assert.equal((await failure(planeGet(conn, '/x/'))).kind, 'timeout')
  } finally {
    env.timeoutMs = saved
  }
})

test('429 with a short wait retries once after the wait', async () => {
  let n = 0
  const fake = fakeFetch(() => (n++ === 0 ? { status: 429, headers: { 'retry-after': '5' } } : { json: [1] }))
  assert.deepEqual(await planeGet(conn, '/x/'), [1])
  assert.equal(fake.calls.length, 2)
  assert.deepEqual(fake.sleeps, [5000])
})

test('429 uses x-ratelimit-reset (epoch seconds) when Retry-After is missing', async () => {
  let n = 0
  const fake = fakeFetch(
    () => (n++ === 0 ? { status: 429, headers: { 'x-ratelimit-reset': '1700000010' } } : { json: 1 }),
    1_700_000_000_000
  )
  assert.equal(await planeGet(conn, '/x/'), 1)
  assert.deepEqual(fake.sleeps, [10_000])
})

test('429 with a long wait does not retry and says until when', async () => {
  const fake = fakeFetch(() => ({ status: 429, headers: { 'retry-after': '60' } }))
  const error = await failure(planeGet(conn, '/x/'))
  assert.equal(error.kind, 'rate_limited')
  assert.equal(error.retryAt, 1_700_000_060_000)
  assert.match(error.message, /until 2023-11-14T22:14:20\.000Z/)
  assert.equal(fake.calls.length, 1)
})

test('429 retries at most once, and not past the deadline', async () => {
  const fake = fakeFetch(() => ({ status: 429, headers: { 'retry-after': '1' } }))
  assert.equal((await failure(planeGet(conn, '/x/'))).kind, 'rate_limited')
  assert.equal(fake.calls.length, 2)

  const late = fakeFetch(() => ({ status: 429, headers: { 'retry-after': '5' } }))
  await failure(planeGet(conn, '/x/', { deadline: 1_700_000_001_000 }))
  assert.equal(late.calls.length, 1)
})
