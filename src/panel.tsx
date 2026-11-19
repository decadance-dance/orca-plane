// The Plane panel (layout: design D10, reworked by P1-P9 of compact-panel-layout). It never sees the token after the connect form submits,
// and never waits on the network for the list: the worker answers from its cache and posts
// `items.changed`.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Input,
  List,
  ListItem,
  Markdown,
  plugin,
  RadioGroup,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  set,
  settings,
  shell,
  Skeleton,
  Stack,
  Text,
  Textarea,
  update,
  type OrcaNode,
  type PanelContext,
  type Tone
} from 'orca'
import type { Item, ItemDetail } from './plane/map'
import { preview } from './plane/markdown'
import {
  type AgentChoice,
  type Attempt,
  type ConnectionStatus,
  type ItemsState,
  KNOWN_AGENTS,
  type LinkView,
  type OrcaProject,
  type StartState
} from './protocol'
import { linkedWorkspace } from './links'
import { readiness } from './readiness'
import { buildPrompt, workspaceName } from './start'

const SLOW = { timeoutMs: 60_000 }

/** Priority tones (design D10); Orca's theme tones are the only colours a plugin has. */
const PRIORITY_TONE = { urgent: 'danger', high: 'accent', medium: 'warning', low: 'success' } as const
const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const

/** States sort by their Plane group first (design D10). */
const GROUP_RANK = { started: 0, unstarted: 1, backlog: 2, unknown: 3 } as const
const UNKNOWN_STATE = 'Unknown state'
/** The agent's state: the icon of a row's workspace control and its name, and a field of the detail (design P7). */
const AGENT_STATE = {
  working: { tone: 'neutral', icon: 'agent', label: 'Agent working', short: 'Working' },
  'needs-input': { tone: 'warning', icon: 'bell', label: 'Agent needs input', short: 'Needs input' },
  done: { tone: 'success', icon: 'check', label: 'Agent done', short: 'Done' }
} as const
/** A pending or unknown attempt is shown as not confirmed (design H4 of start-history). */
const OUTCOME = {
  created: { tone: 'success', label: 'created' },
  failed: { tone: 'danger', label: 'failed' },
  pending: { tone: 'warning', label: 'not confirmed' },
  unknown: { tone: 'warning', label: 'not confirmed' }
} as const
/** A list that is not complete names its state once, with the reason (design P8). */
const COMPLETENESS = {
  partial: { tone: 'warning', label: 'Partial' },
  stale: { tone: 'warning', label: 'Stale' },
  error: { tone: 'danger', label: 'Error' }
} as const

const status = atom<ConnectionStatus | null>(null)
const loadError = atom<string | null>(null)
const items = atom<ItemsState | null>(null)
const starts = atom<Record<string, StartState>>({})
/** Linked keys hidden from the section of items no longer open (closed-item-workspaces C2). */
const hidden = atom<string[]>([])
/** Linked items with their agent state, from the worker (design L3). */
const links = atom<Record<string, LinkView>>({})
/** Posts heard while `loadConnected` waits: they are newer than its snapshots, which never overwrite them. */
let heard: {
  items?: ItemsState
  links?: Record<string, LinkView>
  starts: Record<string, StartState>
  hidden: Record<string, boolean>
} | null = null
const projects = atom<OrcaProject[] | null>(null)
/** Installed agents, then terminal only (design D8). */
const agents = atom<AgentChoice[]>([])

const hostKind = atom<'cloud' | 'self-hosted'>('cloud')
const serverUrl = atom('')
const slug = atom('')
/** Lives only in this panel run, cleared on submit. */
const token = atom('')
const connecting = atom(false)
const connectError = atom<string | null>(null)

/** Without `projectId` the item is fetched by its key alone (a linked item that left the list). */
type ItemRef = { key: string; projectId?: string }
type Loaded = ItemRef & { item: ItemDetail | null; error: string | null }
const search = atom('plane.search', '', { persist: 'plugin' })
/** The header's Search and Filter toggles (design P3, P4); their parts also show while they hold a value. */
const searchShown = atom(false)
const filterShown = atom(false)
/** The header's `⋯`: the "Open by key or URL" field and Disconnect (design P1). */
const moreShown = atom(false)
/** Active tag filters, `priority:<p>` or `label:<name>`; an item must have them all (design D10). */
const tags = atom<string[]>('plane.tags', [], { persist: 'plugin' })
/** The selected Plane project's id (design D10). */
const tab = atom<string | null>('plane.tab', null, { persist: 'plugin' })
/** The open item; persisted, so reopening the panel returns to it. */
const opened = atom<ItemRef | null>('plane.open', null, { persist: 'plugin' })
const detail = atom<Loaded | null>(null)
/** The open item's earlier Starts, oldest first. */
const history = atom<Attempt[]>([])
/** Counts history requests: only the latest one's reply is shown; closing or a connection change drops all. */
let historyAsk = 0
/** The detail shows the whole description; each opened item starts collapsed. */
const descriptionOpen = atom(false)
/** The Start waiting for confirmation; persisted like the open item. */
const confirming = atom<ItemRef | null>('plane.confirm', null, { persist: 'plugin' })
const confirmation = atom<Loaded | null>(null)
const projectId = atom<string | null>(null)
const agent = atom('plane.agent', '', { persist: 'plugin' })
const prompt = atom('')
const startError = atom<string | null>(null)
const openError = atom<string | null>(null)
/** The "Open by key or URL" field and its last refusal (keyboard-commands K1). */
const lookupText = atom('')
const lookupError = atom<string | null>(null)
/** Counts lookups and navigations: a lookup reply after a later lookup, Open or Back is dropped. */
let lookupAsk = 0

/** Only the ref's own fields: an atom holds JSON, which has no undefined. */
const refOf = ({ key, projectId }: ItemRef): ItemRef => (projectId ? { key, projectId } : { key })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Tells the worker which item the detail shows, for the "open the workspace of the item shown" command. */
const tellShown = (key: string | null) => void plugin.request('panel.shown', { key }).catch(() => undefined)

function closeItem(): void {
  lookupAsk++
  if (read(opened)) tellShown(null)
  set(opened, null)
  set(detail, null)
  set(history, [])
  historyAsk++
}

async function loadHistory(key: string): Promise<void> {
  const ask = ++historyAsk
  const attempts = await plugin.request('history.get', { key }).catch(() => [] as Attempt[])
  if (ask === historyAsk && read(opened)?.key === key) set(history, attempts)
}

/** The detail's back button: a Start confirmation opened there closes with it. */
function backToList(): void {
  closeItem()
  cancelStart()
}

function cancelStart(): void {
  set(confirming, null)
  set(confirmation, null)
  set(startError, null)
}

async function loadPickers(): Promise<void> {
  const [list, installed, fallback] = await Promise.all([
    plugin.request('orca.projects').catch(() => ({ projects: [] as OrcaProject[] })),
    plugin
      .request('agents.installed')
      .catch(() => ({ agents: KNOWN_AGENTS.map(({ value, label }) => ({ value, label })) })),
    settings.get('defaultAgent')
  ])
  set(projects, list.projects)
  if (!list.projects.some((project) => project.id === read(projectId))) set(projectId, list.projects[0]?.id ?? null)
  const offered = [...installed.agents, { value: 'none', label: 'Terminal only' }]
  set(agents, offered)
  // The remembered agent if offered, else the defaultAgent setting if offered, else the first.
  const has = (value: unknown) => offered.some((entry) => entry.value === value)
  if (!has(read(agent))) set(agent, has(fallback) ? String(fallback) : offered[0].value)
}

/** Counts loads and connection changes: a load overtaken by either belongs to a former connection. */
let loadAsk = 0

async function loadConnected(): Promise<void> {
  const ask = ++loadAsk
  heard = { starts: {}, hidden: {} }
  const [list, known, linked] = await Promise.all([
    plugin.request('items.list', undefined),
    plugin.request('starts.get'),
    plugin.request('links.get').catch(() => ({})),
    loadPickers()
  ])
  if (ask !== loadAsk) return
  const newer = heard ?? { starts: {}, hidden: {} }
  heard = null
  set(items, newer.items ?? list)
  set(starts, { ...known.states, ...newer.starts })
  // A hiding heard during the load wins over the answer, as the states do.
  const kept = known.hidden.filter((key) => newer.hidden[key] !== false)
  set(hidden, [...new Set([...kept, ...Object.keys(newer.hidden).filter((key) => newer.hidden[key])])])
  set(links, newer.links ?? linked)
  const open = read(opened)
  const asked = read(confirming)
  await Promise.all([open ? openItem(open) : null, asked ? askStart(asked) : null])
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('connection.changed', (next) => {
      set(status, next)
      // What is shown belongs to the old connection: drop it, and load the new one's (the open detail
      // and its history included).
      loadAsk++
      heard = null
      historyAsk++
      set(history, [])
      set(items, null)
      set(starts, {})
      set(hidden, [])
      set(links, {})
      set(lookupError, null)
      // The open detail and confirmation reload (loadConnected); until then they show as loading.
      const open = read(opened)
      set(detail, open ? { ...refOf(open), item: null, error: null } : null)
      set(confirmation, null)
      if (next.connected) {
        // As on the first load: a failure shows Retry, unless another connection change came since.
        void loadConnected().catch((error: unknown) => {
          if (read(status) === next) set(loadError, message(error))
        })
      } else {
        closeItem()
        cancelStart()
      }
    }),
    plugin.on('items.changed', (next) => {
      if (heard) heard.items = next
      set(items, next)
    }),
    plugin.on('start.changed', ({ key, state, hidden: isHidden }) => {
      if (heard) {
        heard.starts[key] = state
        heard.hidden[key] = isHidden === true
      }
      update(starts, (all) => ({ ...all, [key]: state }))
      update(hidden, (keys) => (isHidden ? [...new Set([...keys, key])] : keys.filter((entry) => entry !== key)))
      if (read(opened)?.key === key) void loadHistory(key)
    }),
    plugin.on('links.changed', (next) => {
      if (heard) heard.links = next
      set(links, next)
    }),
    plugin.on('focus.changed', ({ key }) => followFocus(key))
  )
  void load()
}

async function load(): Promise<void> {
  set(loadError, null)
  try {
    const next = await plugin.request('connection.get')
    set(status, next)
    if (next.connected) await loadConnected()
  } catch (error) {
    set(loadError, message(error))
  }
}

async function connect(): Promise<void> {
  const input = { hostKind: read(hostKind), serverUrl: read(serverUrl), slug: read(slug), token: read(token) }
  set(token, '')
  set(connecting, true)
  set(connectError, null)
  try {
    const answer = await plugin.request('connection.connect', input, SLOW)
    if (answer.ok) {
      set(status, answer.status)
      await loadConnected()
    } else {
      set(connectError, answer.error)
    }
  } catch (error) {
    set(connectError, message(error))
  } finally {
    set(connecting, false)
  }
}

async function disconnect(): Promise<void> {
  set(status, await plugin.request('connection.disconnect'))
  set(items, null)
  set(starts, {})
  set(hidden, [])
  set(links, {})
  set(lookupError, null)
  closeItem()
  cancelStart()
}

async function refresh(): Promise<void> {
  set(items, await plugin.request('items.list', { force: true }))
}

async function fetchDetail(ref: ItemRef): Promise<Loaded> {
  const answer = await plugin
    .request('item.get', refOf(ref), SLOW)
    .catch((error: unknown) => ({ ok: false as const, error: message(error) }))
  const at = refOf(ref)
  return answer.ok ? { ...at, item: answer.item, error: null } : { ...at, item: null, error: answer.error }
}

/** `found`: the item a lookup already read, shown without a second request. */
async function openItem(ref: ItemRef, found?: ItemDetail): Promise<void> {
  lookupAsk++
  set(opened, refOf(ref))
  set(detail, { ...refOf(ref), item: found ?? null, error: null })
  set(openError, null)
  set(descriptionOpen, false)
  set(history, [])
  void loadHistory(ref.key)
  tellShown(ref.key)
  if (found) return
  const ask = loadAsk
  const loaded = await fetchDetail(ref)
  // A reply from before a connection change belongs to the former account.
  if (ask === loadAsk && read(detail)?.key === ref.key) set(detail, loaded)
}

/** Opens any item of the workspace by key or URL, listed or not; the worker refuses other servers and workspaces. */
async function lookup(): Promise<void> {
  const text = read(lookupText).trim()
  if (!text) return
  set(lookupError, null)
  const ask = loadAsk
  const mine = ++lookupAsk
  const answer = await plugin
    .request('item.lookup', { text }, SLOW)
    .catch((error: unknown) => ({ ok: false as const, error: message(error) }))
  if (ask !== loadAsk || mine !== lookupAsk) return
  if (!answer.ok) return set(lookupError, answer.error)
  set(lookupText, '')
  await openItem({ key: answer.item.key, projectId: answer.item.projectId }, answer.item)
}

/** The focused Orca workspace belongs to `key` (design L4): show it, unless a Start waits for confirmation. */
function followFocus(key: string | null): void {
  if (!key || read(confirming) || !read(status)?.connected) return
  const listed = read(items)?.items.find((item) => item.key === key)
  void openItem(listed ?? { key })
}

/** Shows the confirmation for a Start, with the prompt built from the item's detail. */
async function askStart(ref: ItemRef): Promise<void> {
  // A Start confirmation supersedes a pending lookup, as an Open does.
  lookupAsk++
  set(confirming, refOf(ref))
  set(confirmation, { ...refOf(ref), item: null, error: null })
  set(startError, null)
  const shown = read(detail)
  const ask = loadAsk
  // The template is read on every confirmation, so a changed setting applies without a reload (design T4).
  const [loaded, template] = await Promise.all([
    shown?.key === ref.key && shown.item ? shown : fetchDetail(ref),
    settings.get('promptTemplate').catch(() => '')
  ])
  if (ask !== loadAsk || read(confirming)?.key !== ref.key) return
  set(confirmation, loaded)
  if (loaded.item) set(prompt, buildPrompt(loaded.item, typeof template === 'string' ? template : ''))
}

async function confirmStart(key: string, name: string): Promise<void> {
  const project = (read(projects) ?? []).find((entry) => entry.id === read(projectId))
  if (!project) return
  set(startError, null)
  const chosen = read(agent)
  try {
    const answer = await plugin.request('item.start', {
      key,
      orcaProjectId: project.id,
      hostId: project.hostId,
      agent: chosen === 'none' ? null : chosen,
      prompt: read(prompt),
      name
    })
    if (answer.accepted) cancelStart()
    else set(startError, answer.reason)
  } catch (error) {
    set(startError, message(error))
  }
}

async function openWorkspace(workspaceId: string): Promise<void> {
  set(openError, null)
  const answer = await plugin.request('workspace.open', { workspaceId }).catch((error: unknown) => ({
    ok: false as const,
    error: message(error)
  }))
  if (!answer.ok) set(openError, answer.error)
}

async function hideLeftover(key: string): Promise<void> {
  set(openError, null)
  try {
    // The worker's start.changed shows the hide: set here, a late reply could hide a newer link.
    await plugin.request('start.hide', { key })
  } catch (error) {
    set(openError, message(error))
  }
}

const matches = (item: Item, query: string) =>
  [item.key, item.title, ...item.labels].some((value) => value.toLowerCase().includes(query))
const tagsOf = (item: Item) => [...(item.priority === 'none' ? [] : [`priority:${item.priority}`]), ...item.labels.map((label) => `label:${label}`)]
const toggleTag = (tag: string) => update(tags, (all) => (all.includes(tag) ? all.filter((entry) => entry !== tag) : [...all, tag]))
function clearFilters(): void {
  set(search, '')
  set(tags, [])
}
/** The key prefix names the project: Plane keeps it unique per workspace. */
const prefix = (key: string) => key.replace(/-[^-]*$/, '')

function ConnectView() {
  const error = read(connectError)
  return (
    <Stack gap="md">
      <Heading>Connect to Plane</Heading>
      <Text muted size="sm">
        Use a personal access token made for this plugin, so it has its own rate limit.
      </Text>
      <RadioGroup
        label="Server"
        value={read(hostKind)}
        options={[
          { value: 'cloud', label: 'Plane Cloud' },
          { value: 'self-hosted', label: 'Self-hosted' }
        ]}
        onChange={(value) => set(hostKind, value === 'self-hosted' ? 'self-hosted' : 'cloud')}
      />
      {read(hostKind) === 'self-hosted' ? (
        <Input
          label="Server URL"
          placeholder="https://plane.example.com"
          value={read(serverUrl)}
          onChange={(value) => set(serverUrl, value)}
        />
      ) : null}
      <Input label="Workspace slug" placeholder="my-team" value={read(slug)} onChange={(value) => set(slug, value)} />
      <Input
        label="Personal access token"
        type="password"
        value={read(token)}
        onChange={(value) => set(token, value)}
        onSubmit={() => void connect()}
      />
      {error ? <Callout tone="danger" title="Not connected">{error}</Callout> : null}
      <Button tone="accent" icon="plug" disabled={read(connecting)} onPress={connect}>
        {read(connecting) ? 'Connecting…' : 'Connect'}
      </Button>
    </Stack>
  )
}

/** The Project and Agent of a Start. */
function Pickers() {
  const list = read(projects)
  return (
    <Stack gap="sm">
      {list && list.length === 0 ? (
        <Callout tone="warning" title="No Git projects">
          Add a Git repository to Orca to start work on an item.
        </Callout>
      ) : (
        <Select
          label="Project"
          value={read(projectId) ?? undefined}
          options={(list ?? []).map((project) => ({ value: project.id, label: project.name }))}
          onChange={(value) => set(projectId, value)}
        />
      )}
      <Select label="Agent" value={read(agent)} options={read(agents)} onChange={(value) => set(agent, value)} />
    </Stack>
  )
}

/** Start work, Starting…, Checking… or Open workspace, by the item's Start state. `compact` (a list row) draws
 *  only the icon, named by its tooltip: the agent's state or a failed Start shows as the icon (design P6, P7).
 *  The full button is the detail's primary action and fills its row (design P9). Callers key it `start:<KEY>`. */
function StartButton({ item, compact = false }: { item: ItemRef; compact?: boolean }) {
  const state = read(starts)[item.key]
  const failed = state?.kind === 'failed'
  const workspaceId = state?.kind === 'created' || state?.kind === 'failed' ? state.workspaceId : undefined
  if (workspaceId) {
    const open = () => openWorkspace(workspaceId)
    if (!compact) {
      return (
        <Button variant="solid" icon="open-external" onPress={open}>
          Open workspace
        </Button>
      )
    }
    const agentState = read(links)[item.key]?.agent
    const shown = agentState ? AGENT_STATE[agentState] : null
    return (
      <IconButton
        size="sm"
        variant="ghost"
        icon={failed ? 'warning' : (shown?.icon ?? 'open-external')}
        tone={failed ? 'danger' : (shown?.tone ?? 'neutral')}
        label={failed ? 'Open workspace · The agent did not start' : shown ? `Open workspace · ${shown.label}` : 'Open workspace'}
        onPress={open}
      />
    )
  }
  const disabled = state?.kind === 'pending' || state?.kind === 'unknown' || read(confirming)?.key === item.key
  const label = state?.kind === 'pending' ? 'Starting…' : state?.kind === 'unknown' ? 'Checking…' : compact ? 'Start' : 'Start work'
  return compact ? (
    <IconButton
      size="sm"
      variant="ghost"
      tone={failed ? 'danger' : 'accent'}
      icon={failed ? 'warning' : 'play'}
      label={failed ? 'Start failed · Start again' : label}
      disabled={disabled}
      onPress={() => askStart(item)}
    />
  ) : (
    <Button variant="solid" icon="play" disabled={disabled} onPress={() => askStart(item)}>
      {label}
    </Button>
  )
}

/** Advice above the prompt (design R2 of start-readiness-hints); it never disables Confirm. */
function ReadinessHints({ description }: { description: string }) {
  const hints = readiness(description)
  if (hints.length === 0) return null
  return (
    <Callout tone="warning" title="This ticket may be hard for an agent">
      <Stack gap="xs">
        {hints.map((hint) => (
          <Text key={hint.id} size="sm">
            {hint.message}
          </Text>
        ))}
      </Stack>
    </Callout>
  )
}

function Confirmation({ current }: { current: Loaded }) {
  const project = (read(projects) ?? []).find((entry) => entry.id === read(projectId))
  const error = read(startError)
  // Shown and sent as one value, so the workspace and branch are the ones the confirmation names.
  const name = current.item ? workspaceName(current.item.key, current.item.title) : ''
  return (
    <Card title={`Start ${current.key}`}>
      <Stack gap="sm">
        {current.error ? <Callout tone="danger">{current.error}</Callout> : null}
        {!current.item && !current.error ? <Skeleton lines={3} label={`Loading ${current.key}`} /> : null}
        <Pickers />
        {current.item ? (
          <Stack gap="sm">
            <Text size="sm">{`Workspace ${name}`}</Text>
            <Text size="sm">{`Branch ${name}`}</Text>
            <ReadinessHints description={current.item.description} />
            <Textarea label="Prompt" rows={8} value={read(prompt)} onChange={(value) => set(prompt, value)} />
          </Stack>
        ) : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Row gap="xs">
          <Button tone="accent" icon="play" disabled={!current.item || !project} onPress={() => confirmStart(current.key, name)}>
            Confirm
          </Button>
          <Button variant="ghost" onPress={cancelStart}>
            Cancel
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}

/** One line (design P6): the pressable item (priority dot, key, title) opens it; the Start or workspace icon
 *  sits beside it, since a pressable ListItem cannot hold other controls. `keyWidth` aligns the titles. */
function ItemRow({ item, keyWidth }: { item: Item; keyWidth: number }) {
  const asked = read(confirmation)
  const asking = asked?.key === item.key
  // Orca refuses a panel of more than 5000 nodes: a row spends as few as it can (no wrapper around the dot or
  // the icon, no Stack unless a confirmation follows), and Groups draws at most MAX_ROWS of them.
  const line = (
    // The title shrinks and truncates; the rest keeps its size, so the row never overflows.
    <Box direction="row" align="center" gap="xs" width="100%" minWidth={0}>
      <Box grow shrink minWidth={0}>
        <List label={item.key}>
          <ListItem key={item.key} onPress={() => openItem(item)}>
            <Box direction="row" align="center" gap="sm" width="100%" minWidth={0}>
              {/* The dot and the key share one column that never shrinks, so the title starts at the same x in
                  every row; a dot of its own would shrink by the title's overflow (#79). */}
              <Box direction="row" align="center" gap="sm" shrink={false} width={keyWidth}>
                {item.priority === 'none' ? (
                  <Text key={`priority:${item.key}`} size="xs" muted>
                    ○
                  </Text>
                ) : (
                  <Text key={`priority:${item.key}`} size="xs" tone={PRIORITY_TONE[item.priority]}>
                    ●
                  </Text>
                )}
                {/* truncate is Orca's only nowrap: a key wider than the column loses its end, never wraps. */}
                <Text key={`key:${item.key}`} size="xs" muted truncate>
                  {item.key}
                </Text>
              </Box>
              <Box grow shrink minWidth={0}>
                <Text size="sm" weight="medium" truncate>
                  {item.title}
                </Text>
              </Box>
            </Box>
          </ListItem>
        </List>
      </Box>
      {asking ? null : <StartButton key={`start:${item.key}`} item={item} compact />}
    </Box>
  )
  return asking ? (
    <Stack gap="xs">
      {line}
      <Confirmation current={asked} />
    </Stack>
  ) : (
    line
  )
}

// Advance widths in px of Geist, Orca's default app font, at `xs` (12 px), rounded up; any other character counts
// as W. A Plane key is an upper-case identifier, a dash and a number.
// limit: Orca has no monospace Text and no way to measure text, so with another app font set in Orca a key may be
// cut short by an ellipsis; widen these if that font is common.
const GLYPH: Record<string, number> = {
  A: 8.1, B: 8.2, C: 8.5, D: 8.4, E: 7.3, F: 7.1, G: 8.4, H: 8.6, I: 3.3, J: 7.2, K: 7.7, L: 7, M: 10.6,
  N: 9, O: 8.9, P: 7.8, Q: 8.8, R: 8.1, S: 7.7, T: 6.7, U: 8.3, V: 8, W: 11.4, X: 7.3, Y: 7, Z: 6.6,
  '0': 8, '1': 4.7, '2': 7.5, '3': 7.4, '4': 7.4, '5': 7.6, '6': 7.2, '7': 6.3, '8': 7.3, '9': 7.2, '-': 5.1
}
// The dot (10.2 px), the `sm` gap (8 px), the longest key, and 2 px for rounding.
const keyWidthOf = (items: Item[]) =>
  Math.ceil(20.2 + Math.max(0, ...items.map((item) => [...item.key].reduce((sum, c) => sum + (GLYPH[c] ?? GLYPH.W), 0))))

// limit: Orca refuses a panel of more than 5000 nodes, and the fetch cap is 1000 items. 150 rows (about 14 nodes
// each) leave room for roughly 250 workspaces of items no longer open or 500 filter tags; past that it goes blank.
const MAX_ROWS = 150

function ListView({ state }: { state: ItemsState | null }) {
  if (!state || state.completeness === null) {
    return <Skeleton lines={4} label="Loading your items" />
  }
  const query = read(search).trim().toLowerCase()
  const active = read(tags)
  const shown = state.items.filter((item) => matches(item, query) && active.every((tag) => tagsOf(item).includes(tag)))
  // One picker entry per project with listed items, ordered by name; a project no longer listed falls back to the first.
  // The newest item names it, so the name is one fixed choice.
  const names = new Map<string, string>()
  for (const item of state.items) if (!names.has(item.projectId)) names.set(item.projectId, prefix(item.key))
  // limit: Orca's Select drops every option past 500, so only the first 500 projects by name are offered;
  // items in more than 500 projects at once are not expected.
  const tabs = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])).slice(0, 500)
  const selected = tabs.some(([id]) => id === read(tab)) ? (read(tab) ?? undefined) : tabs[0]?.[0]
  const inTab = shown.filter((item) => item.projectId === selected)
  const failedOpen = read(openError)
  const incomplete = state.completeness === 'complete' ? null : COMPLETENESS[state.completeness]
  const count = (id: string) => shown.filter((item) => item.projectId === id).length
  return (
    <Stack gap="sm">
      {read(searchShown) || read(search) ? (
        <Input
          label="Search"
          labelHidden
          type="search"
          placeholder="Search by key, title or label"
          value={read(search)}
          onChange={(value) => set(search, value)}
        />
      ) : null}
      {read(filterShown) || active.length > 0 ? <FilterStrip listed={state.items} /> : null}
      {/* A complete list shows only its update time, at the bottom; any other state is named once, with its
          reason, as text: a Callout without a title still draws Orca's own "Warning" (design P8). */}
      {incomplete ? (
        <Text key="list-state" size="sm" tone={incomplete.tone}>
          {state.error ? `${incomplete.label} · ${state.error}` : incomplete.label}
        </Text>
      ) : null}
      {failedOpen ? <Callout tone="danger">{failedOpen}</Callout> : null}
      {state.completeness !== 'error' && state.items.length === 0 ? (
        <EmptyState icon="check" title="Nothing open is assigned to you" />
      ) : null}
      {tabs.length > 0 ? (
        <Stack gap="sm">
          {/* One picker never wraps, however many projects (design P2); "Project" is a Start's Orca project. */}
          <Select
            label="Plane project"
            labelHidden
            value={selected}
            options={tabs.map(([id, name]) => ({
              value: id,
              label: `${name} · ${count(id)} ${count(id) === 1 ? 'item' : 'items'}`
            }))}
            onChange={(value) => set(tab, value)}
          />
          <Groups entries={inTab} all={state.items.filter((item) => item.projectId === selected)} />
        </Stack>
      ) : null}
      {state.completeness === 'complete' ? <Leftovers listed={state.items} /> : null}
      {state.fetchedAt ? (
        <Box key="list-updated" direction="row" justify="center">
          <Text muted size="xs">
            updated <RelativeTime at={state.fetchedAt} />
          </Text>
        </Box>
      ) : null}
    </Stack>
  )
}

/** The `⋯` part stays shown while it holds a key or a refusal. */
const moreHeld = () => read(lookupText) !== '' || read(lookupError) !== null

/** Behind the header's `⋯` (design P1): Open by key or URL, and Disconnect. */
function More() {
  const refused = read(lookupError)
  return (
    <Stack gap="xs">
      <Input
        label="Open by key or URL"
        labelHidden
        placeholder="Open by key or URL, e.g. DIOGEN-12"
        value={read(lookupText)}
        // Editing drops the refusal, so the part can be hidden once the field is empty.
        onChange={(value) => {
          set(lookupText, value)
          set(lookupError, null)
        }}
        onSubmit={() => void lookup()}
      />
      {refused ? (
        <Text key="lookup-error" size="sm" tone="warning">
          {refused}
        </Text>
      ) : null}
      <Row justify="end">
        <Button variant="ghost" size="xs" onPress={disconnect}>
          Disconnect
        </Button>
      </Row>
    </Stack>
  )
}

/** Linked workspaces of items no longer in the complete list (design C1, C4 of closed-item-workspaces):
 *  only a complete list proves that an item left it. */
function Leftovers({ listed }: { listed: Item[] }) {
  const keys = new Set(listed.map((item) => item.key))
  const leftovers = Object.entries(read(starts)).flatMap(([key, state]) => {
    const workspaceId = linkedWorkspace(state)
    if (!workspaceId || keys.has(key) || read(hidden).includes(key)) return []
    // A link saved by an earlier version without a name shows the key only (C3).
    const name = state.kind === 'created' || state.kind === 'failed' ? state.name : undefined
    return [{ key, workspaceId, name }]
  })
  if (leftovers.length === 0) return null
  return (
    <Collapsible title={`No longer in your open items (${leftovers.length})`}>
      <Stack gap="xs">
        {leftovers.map(({ key, workspaceId, name }) => (
          <Box key={key} direction="row" align="center" gap="xs" width="100%" minWidth={0}>
            <Box grow shrink minWidth={0}>
              <Text weight="medium">{key}</Text>
              {name ? (
                <Text muted size="xs" truncate>
                  {name}
                </Text>
              ) : null}
            </Box>
            <Box shrink={false}>
              <Row gap="xs">
                <Button key={`leftover-open:${key}`} size="sm" icon="open-external" onPress={() => openWorkspace(workspaceId)}>
                  Open workspace
                </Button>
                <Button key={`leftover-hide:${key}`} size="sm" variant="ghost" onPress={() => hideLeftover(key)}>
                  Hide
                </Button>
              </Row>
            </Box>
          </Box>
        ))}
      </Stack>
    </Collapsible>
  )
}

/** A tag that toggles itself in the filter: outlined in its tone; while active, filled (accent for a grey
 *  label, which a muted fill did not set apart) and checked (design P4). The colour is on a Box: Orca colours
 *  only `danger` Buttons, so the Button inside is ghost. */
function TagButton({ tag, tone = 'neutral', children }: { tag: string; tone?: Tone; children: string }) {
  const active = read(tags).includes(tag)
  return (
    <Box border={tone} background={active ? (tone === 'neutral' ? 'accent' : tone) : 'none'} radius="full">
      <Button size="xs" variant="ghost" icon={active ? 'check' : undefined} onPress={() => toggleTag(tag)}>
        {children}
      </Button>
    </Box>
  )
}

/** The Filter icon's strip (design P4): the priorities, then the labels, of the whole loaded list, plus any
 *  active tag no longer in it, so a remembered tag can always be turned off. */
function FilterStrip({ listed }: { listed: Item[] }) {
  const active = read(tags)
  const offered = new Set([...listed.flatMap(tagsOf), ...active])
  const labels = [...offered].filter((tag) => tag.startsWith('label:')).sort((a, b) => a.localeCompare(b))
  const priorities = PRIORITIES.filter((priority) => offered.has(`priority:${priority}`))
  if (priorities.length === 0 && labels.length === 0) {
    return (
      <Text muted size="xs">
        No priorities or labels to filter by.
      </Text>
    )
  }
  return (
    <Box direction="row" wrap gap="xs">
      {priorities.map((priority) => (
        <TagButton key={`priority:${priority}`} tag={`priority:${priority}`} tone={PRIORITY_TONE[priority]}>
          {priority}
        </TagButton>
      ))}
      {labels.map((tag) => (
        <TagButton key={tag} tag={tag}>
          {tag.slice('label:'.length)}
        </TagButton>
      ))}
    </Box>
  )
}

function stateOrder(items: Item[]): string[] {
  const states = new Map<string, { rank: number; count: number }>()
  for (const item of items) {
    const name = item.stateName ?? UNKNOWN_STATE
    const known = states.get(name)
    if (known) known.count++
    else states.set(name, { rank: GROUP_RANK[item.stateName ? item.stateGroup : 'unknown'], count: 1 })
  }
  return [...states.entries()]
    .sort(([an, a], [bn, b]) => a.rank - b.rank || b.count - a.count || an.localeCompare(bn))
    .map(([name]) => name)
}

/** One project's shown items by state, ordered by Plane group, then the state's count among `all` (the project's
 *  loaded items, so a search does not reorder them), then name; empty only under a search. */
function Groups({ entries, all }: { entries: Item[]; all: Item[] }) {
  if (entries.length === 0) {
    return (
      <Stack gap="xs">
        <EmptyState icon="search" title="No matching items" description="Try another key, title or label." />
        <Row>
          <Button variant="outline" size="sm" onPress={clearFilters}>
            {read(tags).length > 0 ? 'Clear filters' : 'Clear search'}
          </Button>
        </Row>
      </Stack>
    )
  }
  const keyWidth = keyWidthOf(entries)
  let room = MAX_ROWS
  const groups = stateOrder(all)
    .map((name) => ({ name, rows: entries.filter((item) => (item.stateName ?? UNKNOWN_STATE) === name) }))
    .filter((group) => group.rows.length > 0)
    .map((group) => {
      const drawn = group.rows.slice(0, room)
      room -= drawn.length
      return { ...group, drawn }
    })
    .filter((group) => group.drawn.length > 0)
  // A plain header per state, a separator between states; groups do not collapse (design P5).
  return (
    <Stack gap="sm">
      {groups.map(({ name, rows, drawn }, index) => (
        <Stack key={name} gap="xs">
          {index > 0 ? <Separator /> : null}
          <Box key={`group:${name}`} direction="row" justify="between" align="center" gap="xs" paddingX="sm" minWidth={0}>
            {/* Orca draws a level-3 heading small, upper case and muted, as the mockup's group headers. */}
            <Heading level={3}>{name}</Heading>
            <Text key={`count:${name}`} size="xs" muted>
              {String(rows.length)}
            </Text>
          </Box>
          {drawn.map((item) => (
            <ItemRow key={item.key} item={item} keyWidth={keyWidth} />
          ))}
        </Stack>
      ))}
      {entries.length > MAX_ROWS ? (
        <Text key="rows-capped" size="xs" muted>
          {`Showing ${MAX_ROWS} of ${entries.length}. Search or filter to see the rest.`}
        </Text>
      ) : null}
    </Stack>
  )
}

/** The description as plain text under the actions, with Show more below it (design P9). */
function Description({ text }: { text: string }) {
  const short = preview(text)
  const open = read(descriptionOpen)
  return (
    <Stack gap="xs">
      <Markdown content={short && !open ? short : text} />
      {short ? (
        <Row>
          <Button variant="ghost" size="sm" onPress={() => set(descriptionOpen, !open)}>
            {open ? 'Show less' : 'Show more'}
          </Button>
        </Row>
      ) : null}
    </Stack>
  )
}

/** The item's earlier Starts, newest first; nothing when it was never started. */
function EarlierStarts() {
  const attempts = read(history)
  if (attempts.length === 0) return null
  return (
    <Stack gap="xs">
      <Heading level={3}>Earlier starts</Heading>
      <List label="Earlier starts">
        {[...attempts].reverse().map((attempt) => {
          const agentLabel = attempt.agent
            ? KNOWN_AGENTS.find((known) => known.value === attempt.agent)?.label ?? attempt.agent
            : 'Terminal only'
          const outcome = OUTCOME[attempt.outcome]
          return (
            <ListItem key={attempt.id}>
              <Row gap="xs">
                <Text size="sm">{`${agentLabel} · ${attempt.project}`}</Text>
                <Badge tone={outcome.tone}>{outcome.label}</Badge>
              </Row>
              <Text muted size="xs">
                {`${attempt.workspace} · `}
                <RelativeTime at={attempt.at} />
              </Text>
            </ListItem>
          )
        })}
      </List>
    </Stack>
  )
}

/** A closed item offers no Start, but one with a workspace or a Start under way keeps its button. */
const underWay = (state: StartState | undefined) =>
  state !== undefined && (state.kind === 'pending' || state.kind === 'unknown' || linkedWorkspace(state) !== undefined)

/** A pill outlined and written in its tone, as the mockup's badges; Orca's Badge is filled. */
function Pill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <Box border={tone} radius="full" paddingX="sm">
      <Text size="xs" tone={tone === 'neutral' ? undefined : tone} muted={tone === 'neutral'}>
        {children}
      </Text>
    </Box>
  )
}

/** A label and its value on one line; KeyValue takes only text, so it cannot hold a RelativeTime. */
function Field({ label, children }: { label: string; children: OrcaNode }) {
  return (
    <Box direction="row" gap="sm" minWidth={0}>
      <Box shrink={false} width={72}>
        <Text size="xs" muted>
          {label}
        </Text>
      </Box>
      <Box grow shrink minWidth={0}>
        {children}
      </Box>
    </Box>
  )
}

function DetailView({ current }: { current: Loaded }) {
  const item = current.item
  const state = read(starts)[current.key]
  const asked = read(confirmation)
  const failedOpen = read(openError)
  const agentState = item ? read(links)[item.key]?.agent : undefined
  const updated = item ? Date.parse(item.updatedAt) : Number.NaN
  const startable = item !== null && asked?.key !== item.key && (item.stateGroup !== 'unknown' || underWay(state))
  return (
    <Stack gap="md">
      <Row>
        <Button variant="ghost" size="sm" onPress={backToList}>
          ← All items
        </Button>
      </Row>
      {current.error ? <Callout tone="danger" title={current.key}>{current.error}</Callout> : null}
      {!item && !current.error ? <Skeleton lines={6} label={`Loading ${current.key}`} /> : null}
      {item ? (
        <Stack gap="md">
          {/* The framed header, then the actions, then what follows from them, then the description (design P9). */}
          <Box key="detail-header" direction="column" gap="sm" padding="sm" radius="md" background="muted">
            <Box direction="row" justify="between" align="center" gap="xs" minWidth={0}>
              <Text size="xs" muted>
                {item.key}
              </Text>
              <Pill tone={item.priority === 'none' ? 'neutral' : PRIORITY_TONE[item.priority]}>
                {item.priority === 'none' ? 'No priority' : item.priority}
              </Pill>
            </Box>
            <Heading level={2}>{item.title}</Heading>
            <Stack key="detail-fields" gap="xs">
              <Field label="State">
                <Text size="xs">{item.stateName ?? 'Unknown'}</Text>
              </Field>
              <Field label="Assignees">
                <Text size="xs">{item.assignees.join(', ') || '—'}</Text>
              </Field>
              <Field label="Labels">
                <Text size="xs">{item.labels.join(', ') || '—'}</Text>
              </Field>
              <Field label="Updated">
                <Text size="xs">{Number.isNaN(updated) ? item.updatedAt : <RelativeTime at={updated} />}</Text>
              </Field>
              {agentState ? (
                <Field label="Agent">
                  <Text key="detail-agent" size="xs" tone={AGENT_STATE[agentState].tone === 'neutral' ? undefined : AGENT_STATE[agentState].tone}>
                    {AGENT_STATE[agentState].short}
                  </Text>
                </Field>
              ) : null}
            </Stack>
          </Box>
          {/* Start (or Open workspace) fills the row; Plane keeps its size beside it. */}
          <Box key="detail-actions" direction="row" gap="xs" align="center" width="100%" minWidth={0}>
            {startable ? (
              <Box grow shrink minWidth={0} align="stretch">
                <StartButton key={`start:${item.key}`} item={item} />
              </Box>
            ) : null}
            <Box shrink={false}>
              <Button icon="open-external" variant="outline" tooltip="Open in Plane" onPress={() => shell.openExternal(item.url)}>
                Plane
              </Button>
            </Box>
          </Box>
          {state?.kind === 'failed' ? (
            <Callout tone="danger" title={state.workspaceId ? 'The agent did not start' : 'Start failed'}>
              {state.error}
            </Callout>
          ) : null}
          {failedOpen ? <Callout tone="danger">{failedOpen}</Callout> : null}
          {asked?.key === item.key ? <Confirmation current={asked} /> : null}
          {item.description ? <Description text={item.description} /> : <Text muted size="sm">No description.</Text>}
          <EarlierStarts />
        </Stack>
      ) : null}
    </Stack>
  )
}

/** A header toggle (design P1, P3, P4): outlined while its part shows. A part that holds a value stays shown,
 *  so its toggle is disabled then rather than pressable to no effect. */
function Toggle({ shown, held, icon, name }: { shown: typeof searchShown; held: boolean; icon: 'search' | 'filter' | 'more'; name: string }) {
  const on = read(shown) || held
  return (
    <IconButton
      key={`toggle:${icon}`}
      icon={icon}
      variant={on ? 'outline' : 'ghost'}
      label={`${on ? 'Hide' : 'Show'} ${name}`}
      disabled={held}
      onPress={() => set(shown, !on)}
    />
  )
}

export default function Panel() {
  const current = read(status)
  const failed = read(loadError)
  if (failed) {
    return (
      <Stack gap="sm">
        <Callout tone="danger" title="The Plane worker did not answer">{failed}</Callout>
        <Row>
          <Button icon="refresh" onPress={load}>
            Retry
          </Button>
        </Row>
      </Stack>
    )
  }
  if (current === null) return <Skeleton lines={3} label="Loading" />
  if (!current.connected) return <ConnectView />
  const open = read(detail)
  const list = read(items)
  // The detail starts with its back control, without the list's header (design P9).
  if (open) return <DetailView current={open} />
  return (
    <Stack gap="md">
      {/* The name shrinks and truncates; the icons keep their size, so a narrow sidebar does not scroll. */}
      <Box direction="row" justify="between" align="center" gap="xs" width="100%" minWidth={0}>
        <Box grow shrink minWidth={0}>
          <Text size="xs" weight="semibold">
            Plane
          </Text>
          <Text size="xs" muted truncate>
            {`${current.userName} · ${current.slug}`}
          </Text>
        </Box>
        <Box direction="row" gap="xs" align="center" shrink={false}>
          <Toggle shown={searchShown} held={read(search) !== ''} icon="search" name="search" />
          <Toggle shown={filterShown} held={read(tags).length > 0} icon="filter" name="filters" />
          <IconButton
            icon="refresh"
            variant="ghost"
            label={list?.refreshing ? 'Refreshing' : 'Refresh'}
            disabled={!list || list.refreshing}
            onPress={refresh}
          />
          <Toggle shown={moreShown} held={moreHeld()} icon="more" name="actions" />
        </Box>
      </Box>
      {/* Above the list, so Disconnect is reachable while the first list loads. */}
      {read(moreShown) || moreHeld() ? <More /> : null}
      <ListView state={read(items)} />
    </Stack>
  )
}
