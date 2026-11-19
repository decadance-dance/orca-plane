// The refresh model (design D4) and the status bar count. The worker owns the refresh: the
// panel gets the cache at once and hears `items.changed` when a refresh ends.
import type { OrcaWorkerApi } from 'orca/worker'
import { type Connection, type Connections, keyOf } from './connection'
import { getItem, getItemByKey, listMyOpenItems } from './plane/api'
import { env, PlaneError } from './plane/http'
import { type Item, type ItemDetail, toDetail, toItem } from './plane/map'
import { browseUrl } from './plane/url'
import type { ItemsState, Result } from './protocol'

const STALE_AFTER_MS = 60_000
const DEADLINE_MS = 90_000
const GROUP_ORDER = ['started', 'unstarted', 'backlog', 'unknown']

type Cache = Omit<ItemsState, 'refreshing'> & { checkedAt: number }

/** The manifest's tooltip of the count, sent back when no agent waits. */
const COUNT_TOOLTIP = 'Plane: open work items assigned to you'

const EMPTY: Cache = { items: [], completeness: null, fetchedAt: null, error: null, checkedAt: 0 }

export class Items {
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** The last list the count showed (null: hidden), and how many linked agents need input. */
  private shown: Pick<Cache, 'items' | 'completeness'> | null = null
  private waiting = 0

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly conns: Connections
  ) {
    conns.onChange(async (conn) => {
      this.running = null
      await this.showCount(conn ? EMPTY : null)
      await this.arm()
      if (conn) void this.refresh()
      this.orca.panels.post('items.changed', await this.state())
    })
    orca.settings.onDidChange((change) => {
      if (change.key === 'refreshMinutes') void this.arm()
    })
  }

  private async cache(conn: Connection): Promise<Cache> {
    const saved = (await this.orca.storage.get(keyOf(conn.id, 'items'))) as Cache | null
    if (!saved || typeof saved !== 'object') return EMPTY
    // A cache written before list items carried labels.
    return { ...saved, items: saved.items.map((item) => ({ ...item, labels: item.labels ?? [] })) }
  }

  async state(): Promise<ItemsState> {
    const conn = await this.conns.current()
    if (!conn) return { ...EMPTY, refreshing: false }
    const { checkedAt: _checked, ...cache } = await this.cache(conn)
    return { ...cache, refreshing: this.running !== null }
  }

  /** The cache at once; starts a refresh when it is older than a minute or `force` is set. */
  async list(force = false): Promise<ItemsState> {
    const conn = await this.conns.current()
    if (conn && (force || env.now() - (await this.cache(conn)).checkedAt > STALE_AFTER_MS)) {
      void this.refresh()
    }
    return this.state()
  }

  /** One refresh at a time: later calls join the running one. */
  refresh(): Promise<void> {
    if (!this.running) {
      const run: Promise<void> = this.run().finally(() => {
        if (this.running === run) this.running = null
      })
      this.running = run
    }
    return this.running
  }

  private async run(): Promise<void> {
    const conn = await this.conns.current()
    if (!conn) return
    const generation = this.conns.generation
    const signal = this.conns.signal
    const previous = await this.cache(conn)
    const started = env.now()
    const deadline = new AbortController()
    const timer = setTimeout(
      () => deadline.abort(new PlaneError('timeout', 'Plane did not answer within 90 seconds.')),
      DEADLINE_MS
    )
    const abort = () => deadline.abort()
    signal.addEventListener('abort', abort)
    let next: Cache
    try {
      const result = await listMyOpenItems(conn, conn.slug, conn.userId, {
        signal: deadline.signal,
        deadline: started + DEADLINE_MS
      })
      const items = result.rows.map(toItem).filter((item): item is Item => item !== null)
      const dropped = result.rows.length - items.length
      items.sort((a, b) => GROUP_ORDER.indexOf(a.stateGroup) - GROUP_ORDER.indexOf(b.stateGroup))
      next = {
        items,
        completeness: result.completeness === 'complete' && !dropped ? 'complete' : 'partial',
        fetchedAt: env.now(),
        error: result.error ?? (dropped ? `${dropped} items could not be read.` : null),
        checkedAt: env.now()
      }
    } catch (error) {
      const message = error instanceof PlaneError ? error.message : 'The refresh failed.'
      next = previous.completeness
        ? { ...previous, completeness: previous.completeness === 'error' ? 'error' : 'stale', error: message, checkedAt: env.now() }
        : { ...EMPTY, completeness: 'error', error: message, checkedAt: env.now() }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    // A disconnect or account switch while this ran: its result belongs to no one.
    await this.conns.whileCurrent(generation, async () => {
      await this.orca.storage.set(keyOf(conn.id, 'items'), next)
      await this.showCount(next)
      this.orca.panels.post('items.changed', { ...withoutChecked(next), refreshing: false })
    })
  }

  /** Without `projectId`, by the key alone: a linked item may have left the list (design L5). */
  async detail(key: string, projectId?: string): Promise<Result<{ item: ItemDetail }>> {
    const conn = await this.conns.current()
    if (!conn) return { ok: false, error: 'Not connected to Plane.' }
    try {
      const raw = projectId
        ? await getItem(conn, conn.slug, projectId, key, this.conns.signal)
        : await getItemByKey(conn, conn.slug, key, this.conns.signal)
      const item = toDetail(raw, (itemKey) => browseUrl(conn.appBase, conn.slug, itemKey))
      return item ? { ok: true, item } : { ok: false, error: 'Plane sent an unreadable item.' }
    } catch (error) {
      return { ok: false, error: error instanceof PlaneError ? error.message : 'Could not load the item.' }
    }
  }

  /**
   * The count when complete, `?` otherwise, hidden when disconnected (null); with linked agents
   * that need input, their number after it in a warning tone (design L6).
   */
  async showCount(cache: Pick<Cache, 'items' | 'completeness'> | null): Promise<void> {
    this.shown = cache
    const count = cache?.completeness === 'complete' ? String(cache.items.length) : '?'
    const waiting = this.waiting
    const params =
      cache === null
        ? { id: 'count', visible: false }
        : waiting > 0
          ? {
              id: 'count',
              visible: true,
              text: `${count} · ${waiting} waiting`,
              tone: 'warning' as const,
              tooltip: waiting === 1 ? '1 agent on Plane items waits for you' : `${waiting} agents on Plane items wait for you`
            }
          : { id: 'count', visible: true, text: count, tone: 'neutral' as const, tooltip: COUNT_TOOLTIP }
    try {
      await this.orca.host.call('statusBar.update', params)
    } catch {
      // limit: the status bar exists only in the desktop app; elsewhere the count is skipped.
    }
  }

  /** How many linked agents need input; shows it at once when it changed. */
  async showWaiting(waiting: number): Promise<void> {
    if (waiting === this.waiting) return
    this.waiting = waiting
    await this.showCount(this.shown)
  }

  /** (Re)arms the background refresh; none runs while disconnected. */
  async arm(): Promise<void> {
    const minutes = Number(await this.orca.settings.get('refreshMinutes'))
    const conn = await this.conns.current()
    // No await from here on, so two arms at once still leave one timer.
    this.stop()
    if (!conn) return
    const every = Math.min(60, Math.max(5, Number.isFinite(minutes) ? minutes : 10)) * 60_000
    this.timer = setInterval(() => void this.refresh(), every)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** On worker start: show the last known count and arm the timer. */
  async start(): Promise<void> {
    const conn = await this.conns.current()
    await this.showCount(conn ? await this.cache(conn) : null)
    await this.arm()
  }
}

function withoutChecked({ checkedAt: _checked, ...rest }: Cache): Omit<ItemsState, 'refreshing'> {
  return rest
}
