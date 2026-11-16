// The only way the plugin talks to Plane: every request is bound to one connection's API base,
// carries its token in X-API-Key, never follows a redirect, and fails with a classified error.

export type Conn = { apiBase: string; token: string }

export type ErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'unsupported_server'
  | 'network'
  | 'timeout'
  | 'bad_response'
  | 'cancelled'

/** Carries the status and the server's own error text, never the request or its headers. */
export class PlaneError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly status?: number,
    /** For `rate_limited`: when the limit ends, epoch ms. */
    readonly retryAt?: number
  ) {
    super(message)
    this.name = 'PlaneError'
  }
}

/** Swapped by tests; the worker uses the real ones. */
export const env = {
  fetch: (url: string, init: RequestInit): Promise<Response> => globalThis.fetch(url, init),
  now: (): number => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: 10_000
}

const MAX_RETRY_WAIT_MS = 30_000

export type GetOptions = {
  query?: Record<string, string>
  signal?: AbortSignal
  /** Epoch ms after which no retry is attempted. */
  deadline?: number
}

/** `path` is relative to the API base, e.g. `/api/v2/users/me/`. */
export async function planeGet(conn: Conn, path: string, options: GetOptions = {}): Promise<unknown> {
  const url = new URL(conn.apiBase + path)
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
  if (url.origin !== new URL(conn.apiBase).origin) {
    throw new PlaneError('bad_response', 'Refused a request outside the connected server.')
  }
  try {
    return await once(conn, url.toString(), options.signal)
  } catch (error) {
    if (!(error instanceof PlaneError) || error.kind !== 'rate_limited' || error.retryAt === undefined) {
      throw error
    }
    const wait = Math.max(0, error.retryAt - env.now())
    const deadline = options.deadline ?? Infinity
    if (wait > MAX_RETRY_WAIT_MS || env.now() + wait >= deadline) throw error
    await env.sleep(wait)
    if (options.signal?.aborted) throw new PlaneError('cancelled', 'Cancelled.')
    return await once(conn, url.toString(), options.signal)
  }
}

async function once(conn: Conn, url: string, outer?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, env.timeoutMs)
  const onAbort = () => controller.abort()
  outer?.addEventListener('abort', onAbort)
  try {
    const response = await env.fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': conn.token, Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    })
    // The body read stays under the same timeout.
    const body = await response.text()
    return parse(response, body, conn.token)
  } catch (error) {
    if (error instanceof PlaneError) throw error
    if (timedOut) throw new PlaneError('timeout', 'Plane did not answer in time.')
    if (outer?.aborted) throw new PlaneError('cancelled', 'Cancelled.')
    throw new PlaneError('network', 'Could not reach the Plane server.')
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }
}

function parse(response: Response, body: string, token: string): unknown {
  const status = response.status
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('text/html') || /^\s*</.test(body)) {
    throw new PlaneError('unsupported_server', 'The server did not answer as Plane API v2.', status)
  }
  let json: unknown
  try {
    json = body ? JSON.parse(body) : null
  } catch {
    throw new PlaneError('bad_response', `Plane sent an unreadable answer (HTTP ${status}).`, status)
  }
  if (status >= 200 && status < 300 && !response.redirected) return json
  const detail = serverText(json, token)
  const say = (text: string) => (detail ? `${text}: ${detail}` : text)
  if (status === 401) throw new PlaneError('auth', say('Plane refused the token'), status)
  if (status === 403) throw new PlaneError('forbidden', say('Plane denied access'), status)
  if (status === 404) throw new PlaneError('not_found', say('Not found'), status)
  if (status === 429) {
    const retryAt = retryAtFrom(response.headers)
    const until = retryAt === undefined ? '' : ` until ${new Date(retryAt).toISOString()}`
    throw new PlaneError('rate_limited', `Plane rate limit reached${until}.`, status, retryAt)
  }
  throw new PlaneError('bad_response', say(`Plane answered HTTP ${status}`), status)
}

// Plane puts its message in `error` or `detail`; the token is masked in case a server echoes it.
function serverText(json: unknown, token: string): string {
  if (!json || typeof json !== 'object') return ''
  const record = json as Record<string, unknown>
  const text = typeof record.error === 'string' ? record.error : typeof record.detail === 'string' ? record.detail : ''
  return (token ? text.split(token).join('***') : text).slice(0, 300)
}

function retryAtFrom(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return env.now() + seconds * 1000
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return date
  }
  const reset = Number(headers.get('x-ratelimit-reset'))
  return reset > 0 ? reset * 1000 : undefined
}
