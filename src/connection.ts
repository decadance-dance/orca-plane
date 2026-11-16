// The one Plane connection (design D2): a single encrypted secret record, a connection id that
// keys every storage entry, a lock so connects and disconnects run one at a time, and a
// generation counter so results that started under an older connection are dropped.
import type { OrcaWorkerApi } from 'orca/worker'
import { listMyOpenItems, me } from './plane/api'
import { type Conn, PlaneError } from './plane/http'
import { normalizeServer, normalizeSlug, type UrlError } from './plane/url'
import type { ConnectInput, ConnectionStatus, Result } from './protocol'

const SECRET = 'connection'

export type Connection = Conn & {
  appBase: string
  hostKind: 'cloud' | 'self-hosted'
  slug: string
  userId: string
  userName: string
  /** sha256(apiBase, slug, userId); not stored in the record. */
  id: string
}

/** Every storage key of a connection starts with this. */
export const keyOf = (id: string, name: string) => `c:${id}:${name}`

export const URL_MESSAGES: Record<UrlError, string> = {
  empty: 'Enter the server address.',
  invalid_url: 'The server address is not a valid URL.',
  unsupported_protocol: 'The server address must start with https://.',
  credentials_in_url: 'Remove the user name and password from the server address.',
  insecure: 'Refused: plain http is allowed only to this machine (localhost). Use https://.'
}

export async function connectionId(apiBase: string, slug: string, userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${apiBase}\n${slug}\n${userId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 24)
}

function connectError(error: unknown, slug: string): string {
  if (!(error instanceof PlaneError)) return 'Could not connect to Plane.'
  switch (error.kind) {
    case 'auth':
      return 'The token is invalid.'
    case 'not_found':
      return `Workspace "${slug}" was not found.`
    case 'unsupported_server':
      return 'This server is not supported: it does not serve Plane API v2.'
    default:
      return error.message
  }
}

export class Connections {
  /** Bumped by every connect and disconnect. */
  generation = 0
  private record: Connection | null | undefined
  private controller = new AbortController()
  private lock: Promise<unknown> = Promise.resolve()
  private listeners: ((conn: Connection | null) => void | Promise<void>)[] = []

  constructor(private readonly orca: OrcaWorkerApi) {}

  /** Runs after each connect and disconnect, inside the lock. */
  onChange(listener: (conn: Connection | null) => void | Promise<void>): void {
    this.listeners.push(listener)
  }

  /** Aborts when the connection it was read under goes away. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  async current(): Promise<Connection | null> {
    if (this.record === undefined) this.record = await this.load()
    return this.record
  }

  async status(): Promise<ConnectionStatus> {
    const conn = await this.current()
    return conn
      ? { connected: true, hostKind: conn.hostKind, server: conn.appBase, slug: conn.slug, userName: conn.userName }
      : { connected: false }
  }

  private async load(): Promise<Connection | null> {
    let saved: Record<string, unknown>
    try {
      saved = JSON.parse((await this.orca.secrets.get(SECRET)) ?? 'null') ?? {}
    } catch {
      return null
    }
    const { token, apiBase, appBase, hostKind, slug, userId, userName } = saved
    if (
      typeof token !== 'string' ||
      typeof apiBase !== 'string' ||
      typeof appBase !== 'string' ||
      (hostKind !== 'cloud' && hostKind !== 'self-hosted') ||
      typeof slug !== 'string' ||
      typeof userId !== 'string' ||
      typeof userName !== 'string'
    ) {
      return null
    }
    const id = await connectionId(apiBase, slug, userId)
    return { token, apiBase, appBase, hostKind, slug, userId, userName, id }
  }

  private locked<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lock.then(task, task)
    this.lock = run.catch(() => undefined)
    return run
  }

  /** Runs `task` inside the lock, and only if no connect or disconnect ran since `generation`. */
  whileCurrent(generation: number, task: () => Promise<void>): Promise<void> {
    return this.locked(async () => {
      if (generation === this.generation) await task()
    })
  }

  connect(input: ConnectInput): Promise<Result<{ status: ConnectionStatus }>> {
    return this.locked(async () => {
      if ((await this.orca.host.call('secrets.protection')).status !== 'os-keyring') {
        return { ok: false, error: 'A protected key store is required: Orca reports that secrets cannot be encrypted on this system.' }
      }
      const urls = normalizeServer(
        input.hostKind === 'cloud' ? { hostKind: 'cloud' } : { hostKind: 'self-hosted', serverUrl: input.serverUrl }
      )
      if (!urls.ok) return { ok: false, error: URL_MESSAGES[urls.error] }
      const slug = normalizeSlug(input.slug)
      if (!slug) return { ok: false, error: 'Enter the workspace slug: the part after the server in its URL.' }
      const token = typeof input.token === 'string' ? input.token.trim() : ''
      if (!token) return { ok: false, error: 'Enter a personal access token.' }

      const candidate: Conn = { apiBase: urls.apiBase, token }
      let user: { id: string; displayName: string }
      try {
        // users/me first: a 404 there means no v2, a 404 on the list then means no such workspace.
        user = await me(candidate)
        await listMyOpenItems(candidate, slug, user.id, { maxPages: 1 })
      } catch (error) {
        return { ok: false, error: connectError(error, slug) }
      }
      const record = {
        token,
        apiBase: urls.apiBase,
        appBase: urls.appBase,
        hostKind: urls.hostKind,
        slug,
        userId: user.id,
        userName: user.displayName
      }
      try {
        await this.orca.secrets.set(SECRET, JSON.stringify(record))
      } catch {
        return { ok: false, error: 'Orca could not save the connection.' }
      }
      const id = await connectionId(record.apiBase, slug, user.id)
      this.switchTo({ ...record, id })
      await this.dropStorage((key) => !key.startsWith(keyOf(id, '')))
      await this.notify()
      return { ok: true, status: await this.status() }
    })
  }

  disconnect(): Promise<ConnectionStatus> {
    return this.locked(async () => {
      await this.orca.secrets.delete(SECRET)
      this.switchTo(null)
      await this.dropStorage(() => true)
      await this.notify()
      return { connected: false }
    })
  }

  private switchTo(record: Connection | null): void {
    this.controller.abort()
    this.controller = new AbortController()
    this.generation++
    this.record = record
  }

  private async dropStorage(drop: (key: string) => boolean): Promise<void> {
    for (const key of await this.orca.storage.keys()) {
      if (key.startsWith('c:') && drop(key)) await this.orca.storage.delete(key)
    }
  }

  private async notify(): Promise<void> {
    for (const listener of this.listeners) await listener(this.record ?? null)
  }
}
