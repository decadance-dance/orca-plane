// Ported from stablyai/orca#29182 at b86a6e39 (MIT, see NOTICE): src/shared/plane-url.ts,
// src/shared/web-origin-security.ts and src/shared/plane-ids.ts. Trimmed to what the plugin uses:
// server URL normalization, origin rules, slug validation and the browse URL.

export const PLANE_CLOUD_API = 'https://api.plane.so'
export const PLANE_CLOUD_APP = 'https://app.plane.so'
const PLANE_CLOUD_HOSTS = new Set(['api.plane.so', 'app.plane.so'])

// Top-level web routes Plane reserves, so none of them can be a workspace slug.
const RESERVED_ROOT_ROUTES = new Set([
  'god-mode',
  'profile',
  'sign-in',
  'sign-up',
  'accounts',
  'auth',
  'create-workspace',
  'invitations',
  'workspace-invitations',
  'onboarding',
  'spaces',
  'api'
])
// Routes that only exist under `/{slug}/`, so the segment before one is the slug.
const WORKSPACE_ROUTES = new Set([
  'projects',
  'browse',
  'settings',
  'analytics',
  'active-cycles',
  'notifications',
  'drafts',
  'pages',
  'stickies',
  'workspace-views'
])
// A scheme is letters then `:`; `host:8080` is a port, not a scheme.
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:(?!\d)/i
// Plane slugs are lowercase url-safe names; the length cap matches its 48-char limit.
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/

export type ServerInput = { hostKind: 'cloud' } | { hostKind: 'self-hosted'; serverUrl: string }

export type UrlError =
  | 'empty'
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'credentials_in_url'
  | 'insecure'

/** `apiBase` and `appBase` are an origin plus an optional install path, with no trailing slash. */
export type ServerUrls =
  | { ok: true; hostKind: 'cloud' | 'self-hosted'; apiBase: string; appBase: string }
  | { ok: false; error: UrlError }

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

/** Plain http to another machine would send the token across the network unencrypted. */
export function isInsecureRemote(base: string): boolean {
  const url = new URL(base)
  return url.protocol === 'http:' && !isLoopbackHostname(url.hostname)
}

function parseHttpUrl(raw: string): URL | UrlError {
  const trimmed = raw.trim()
  if (!trimmed) return 'empty'
  const hasScheme = SCHEME_PATTERN.test(trimmed) && !/^[^/]*@/.test(trimmed.split('//')[0])
  let url: URL
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return 'invalid_url'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unsupported_protocol'
  if (url.username || url.password) return 'credentials_in_url'
  return url.hostname ? url : 'invalid_url'
}

// Drops a pasted browser or API path, keeping the install's path prefix.
function serverPrefix(segments: string[]): string[] {
  const lower = segments.map((segment) => segment.toLowerCase())
  const apiIndex = lower.indexOf('api')
  if (apiIndex !== -1) return segments.slice(0, apiIndex)
  const routeIndex = lower.findIndex((segment, index) => index > 0 && WORKSPACE_ROUTES.has(segment))
  if (routeIndex !== -1) return segments.slice(0, routeIndex - 1)
  const reservedIndex = lower.findIndex((segment) => RESERVED_ROOT_ROUTES.has(segment))
  return reservedIndex === -1 ? segments : segments.slice(0, reservedIndex)
}

/** Never probes the network: the URLs come only from what the user typed. */
export function normalizeServer(input: ServerInput): ServerUrls {
  const cloud: ServerUrls = {
    ok: true,
    hostKind: 'cloud',
    apiBase: PLANE_CLOUD_API,
    appBase: PLANE_CLOUD_APP
  }
  if (input.hostKind === 'cloud') return cloud
  const url = parseHttpUrl(input.serverUrl)
  if (typeof url === 'string') return { ok: false, error: url }
  // A Cloud URL pasted into the self-hosted field means Plane Cloud.
  if (PLANE_CLOUD_HOSTS.has(url.hostname.toLowerCase())) return cloud
  const prefix = serverPrefix(url.pathname.split('/').filter(Boolean))
  const base = `${url.protocol}//${url.host}${prefix.map((segment) => `/${segment}`).join('')}`
  if (isInsecureRemote(base)) return { ok: false, error: 'insecure' }
  return { ok: true, hostKind: 'self-hosted', apiBase: base, appBase: base }
}

export function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim().toLowerCase()
  return WORKSPACE_SLUG_PATTERN.test(slug) ? slug : null
}

export function browseUrl(appBase: string, slug: string, key: string): string {
  return `${appBase}/${encodeURIComponent(slug)}/browse/${encodeURIComponent(key)}/`
}

export type ItemRef = { key: string } | { projectId: string; id: string } | { reason: string }

const KEY_PATTERN = /^[a-z0-9]+-\d+$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const NOT_THIS_WORKSPACE = 'This URL is not from the connected Plane workspace.'
export const NOT_A_REF = 'Enter an item key such as DIOGEN-12, or paste a Plane URL of an item.'

/**
 * A typed key or a pasted item URL of the connected workspace (design K1 of keyboard-commands); local
 * only, so a refused text sends no request. A URL must start with the app base, its path prefix included.
 */
export function parseItemRef(text: string, conn: { appBase: string; slug: string }): ItemRef {
  const trimmed = text.trim()
  if (KEY_PATTERN.test(trimmed)) return { key: trimmed.toUpperCase() }
  if (!/^https?:\/\//i.test(trimmed)) return { reason: NOT_A_REF }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { reason: NOT_A_REF }
  }
  const base = new URL(`${conn.appBase}/${encodeURIComponent(conn.slug)}/`)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return { reason: NOT_THIS_WORKSPACE }
  const rest = url.pathname.slice(base.pathname.length).split('/').filter(Boolean).map(decodeURIComponent)
  if (rest[0] === 'browse' && rest.length === 2 && KEY_PATTERN.test(rest[1])) return { key: rest[1].toUpperCase() }
  if (rest[0] === 'projects' && rest[2] === 'issues' && rest.length === 4 && UUID_PATTERN.test(rest[1]) && UUID_PATTERN.test(rest[3])) {
    return { projectId: rest[1], id: rest[3] }
  }
  return { reason: NOT_A_REF }
}
