// The Plane panel (layout: design D10). It never sees the token after the connect form submits,
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
  KeyValue,
  List,
  ListItem,
  Markdown,
  plugin,
  RadioGroup,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  settings,
  shell,
  Skeleton,
  Stack,
  Text,
  Textarea,
  update,
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

/** Priority pill outlines (design D10); Orca's theme tones are the only colours a plugin has. */
const PRIORITY_TONE = { urgent: 'danger', high: 'accent', medium: 'warning', low: 'success' } as const

/** States sort by their Plane group first (design D10). */
const GROUP_RANK = { started: 0, unstarted: 1, backlog: 2, unknown: 3 } as const
const UNKNOWN_STATE = 'Unknown state'
const AGENT_BADGE = {
  working: { tone: 'neutral', label: 'Working' },
  'needs-input': { tone: 'warning', label: 'Needs input' },
  done: { tone: 'success', label: 'Done' }
} as const
/** A pending or unknown attempt is shown as not confirmed (design H4 of start-history). */
const OUTCOME = {
  created: { tone: 'success', label: 'created' },
  failed: { tone: 'danger', label: 'failed' },
  pending: { tone: 'warning', label: 'not confirmed' },
  unknown: { tone: 'warning', label: 'not confirmed' }
} as const
const COMPLETENESS = {
  complete: { tone: 'success', label: 'Complete' },
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
  const loaded = shown?.key === ref.key && shown.item ? shown : await fetchDetail(ref)
  if (ask !== loadAsk || read(confirming)?.key !== ref.key) return
  set(confirmation, loaded)
  if (loaded.item) set(prompt, buildPrompt(loaded.item))
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

/** Start, Starting…, Checking… or Open workspace, by the item's Start state; `compact` draws only
 *  the icon, named by its tooltip (list rows). Callers key it `start:<KEY>`. */
function StartButton({ item, compact = false }: { item: ItemRef; compact?: boolean }) {
  const state = read(starts)[item.key]
  const workspaceId = state?.kind === 'created' || state?.kind === 'failed' ? state.workspaceId : undefined
  if (workspaceId) {
    const open = () => openWorkspace(workspaceId)
    return compact ? (
      <IconButton size="sm" variant="ghost" icon="open-external" label="Open workspace" onPress={open} />
    ) : (
      <Button size="sm" icon="open-external" onPress={open}>
        Open workspace
      </Button>
    )
  }
  const disabled = state?.kind === 'pending' || state?.kind === 'unknown' || read(confirming)?.key === item.key
  const label = state?.kind === 'pending' ? 'Starting…' : state?.kind === 'unknown' ? 'Checking…' : 'Start'
  return compact ? (
    <IconButton size="sm" variant="ghost" tone="accent" icon="play" label={label} disabled={disabled} onPress={() => askStart(item)} />
  ) : (
    <Button size="sm" tone="accent" icon="play" disabled={disabled} onPress={() => askStart(item)}>
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

/** The agent state of the item's linked workspace; nothing when none is known. */
function AgentBadge({ itemKey }: { itemKey: string }) {
  const agent = read(links)[itemKey]?.agent
  if (!agent) return null
  const badge = AGENT_BADGE[agent]
  return <Badge tone={badge.tone}>{badge.label}</Badge>
}

/** A row after Orca's Agents panel (design D10): the pressable item (title, then a muted meta line) opens
 *  it; Start sits beside it, since a pressable ListItem cannot hold other controls. */
function ItemRow({ item }: { item: Item }) {
  const state = read(starts)[item.key]
  const asked = read(confirmation)
  const meta = `${item.key} · ${item.stateName ?? UNKNOWN_STATE}`
  const updated = Date.parse(item.updatedAt)
  return (
    <Stack gap="xs">
      {/* The item shrinks and truncates; Start keeps its size, so the row never overflows. */}
      <Box direction="row" align="center" gap="xs" width="100%" minWidth={0}>
        <Box grow shrink minWidth={0}>
          <List label={item.key}>
            <ListItem key={item.key} onPress={() => openItem(item)}>
              <Text weight="medium" truncate>
                {item.title}
              </Text>
              <Text muted size="xs">
                {Number.isNaN(updated) ? meta : `${meta} · `}
                {Number.isNaN(updated) ? null : <RelativeTime at={updated} />}
              </Text>
              {state?.kind === 'failed' || read(links)[item.key]?.agent ? (
                <Row gap="xs">
                  {state?.kind === 'failed' ? <Badge tone="danger">Start failed</Badge> : null}
                  <AgentBadge itemKey={item.key} />
                </Row>
              ) : null}
            </ListItem>
          </List>
        </Box>
        {asked?.key === item.key ? null : (
          <Box shrink={false}>
            <StartButton key={`start:${item.key}`} item={item} compact />
          </Box>
        )}
      </Box>
      {item.priority !== 'none' || item.labels.length > 0 ? (
        <Box direction="row" wrap gap="xs" paddingX="sm">
          {item.priority === 'none' ? null : (
            <TagButton key={`priority:${item.key}`} tag={`priority:${item.priority}`} tone={PRIORITY_TONE[item.priority]}>
              {item.priority}
            </TagButton>
          )}
          {item.labels.map((label) => (
            <TagButton key={label} tag={`label:${label}`}>
              {label}
            </TagButton>
          ))}
        </Box>
      ) : null}
      {asked?.key === item.key ? <Confirmation current={asked} /> : null}
    </Stack>
  )
}

function ListView({ state }: { state: ItemsState | null }) {
  if (!state || state.completeness === null) {
    return <Skeleton lines={4} label="Loading your items" />
  }
  const badge = COMPLETENESS[state.completeness]
  const query = read(search).trim().toLowerCase()
  const active = read(tags)
  const shown = state.items.filter((item) => matches(item, query) && active.every((tag) => tagsOf(item).includes(tag)))
  // One tab per project with listed items, ordered by name; a project no longer listed falls back to the first.
  // The newest item names it, so the name is one fixed choice.
  const names = new Map<string, string>()
  for (const item of state.items) if (!names.has(item.projectId)) names.set(item.projectId, prefix(item.key))
  const tabs = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const selected = tabs.some(([id]) => id === read(tab)) ? (read(tab) ?? undefined) : tabs[0]?.[0]
  const inTab = shown.filter((item) => item.projectId === selected)
  const failedOpen = read(openError)
  return (
    <Stack gap="md">
      <Input
        label="Search"
        labelHidden
        type="search"
        placeholder="Search by key, title or label"
        value={read(search)}
        onChange={(value) => set(search, value)}
      />
      <Input
        label="Open by key or URL"
        labelHidden
        placeholder="Open by key or URL, e.g. DIOGEN-12"
        value={read(lookupText)}
        onChange={(value) => set(lookupText, value)}
        onSubmit={() => void lookup()}
      />
      {read(lookupError) ? <Callout tone="warning">{read(lookupError)}</Callout> : null}
      <Row justify="between">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {state.fetchedAt ? (
          <Text muted size="xs">
            updated <RelativeTime at={state.fetchedAt} />
          </Text>
        ) : null}
      </Row>
      {state.error ? (
        <Callout tone={state.completeness === 'error' ? 'danger' : 'warning'} title={badge.label}>
          {state.error}
        </Callout>
      ) : null}
      {failedOpen ? <Callout tone="danger">{failedOpen}</Callout> : null}
      {state.completeness !== 'error' && state.items.length === 0 ? (
        <EmptyState icon="check" title="Nothing open is assigned to you" />
      ) : null}
      {tabs.length > 0 ? (
        <Stack gap="sm">
          {/* A segmented switcher like the Agents panel's; Orca Tabs scroll sideways and cut labels off.
              Each segment grows, so every line of segments fills the width. */}
          <Box direction="row" wrap gap="xs" padding="xs" radius="md" background="muted">
            {tabs.map(([id, name]) => (
              <Box key={id} grow align="stretch">
                <Button
                  key={`tab:${id}`}
                  size="xs"
                  variant={id === selected ? 'outline' : 'ghost'}
                  onPress={() => set(tab, id)}
                >
                  {`${name} ${shown.filter((item) => item.projectId === id).length}`}
                </Button>
              </Box>
            ))}
          </Box>
          <Box direction="row" justify="between" paddingX="sm" paddingY="xs" radius="sm" background="muted">
            <Text weight="semibold" size="xs">{`${inTab.length} ${inTab.length === 1 ? 'item' : 'items'}`}</Text>
            <Text muted size="xs">
              Last updated
            </Text>
          </Box>
          <Groups entries={inTab} all={state.items.filter((item) => item.projectId === selected)} />
        </Stack>
      ) : null}
      {state.completeness === 'complete' ? <Leftovers listed={state.items} /> : null}
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

/** A tag that toggles itself in the filter: outlined in its tone, filled with it while active (design D10).
 *  The colour is on a Box: Orca colours only `danger` Buttons, so the Button inside is ghost. */
function TagButton({ tag, tone = 'neutral', children }: { tag: string; tone?: Tone; children: string }) {
  const active = read(tags).includes(tag)
  return (
    <Box border={tone} background={active ? (tone === 'neutral' ? 'muted' : tone) : 'none'} radius="full">
      <Button size="xs" variant="ghost" onPress={() => toggleTag(tag)}>
        {children}
      </Button>
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

/** One tab's shown items by state, ordered by Plane group, then the state's count among `all` (the tab's
 *  loaded items, so a search does not reorder them), then name; empty only under a search. */
function Groups({ entries, all }: { entries: Item[]; all: Item[] }) {
  if (entries.length === 0) {
    return (
      <Stack gap="xs">
        <EmptyState icon="search" title="No matching items" description="Try another key, title or label." />
        <Row>
          <Button variant="ghost" onPress={clearFilters}>
            Clear search
          </Button>
        </Row>
      </Stack>
    )
  }
  return (
    <Stack gap="md">
      {stateOrder(all).map((name) => {
        const inGroup = entries.filter((item) => (item.stateName ?? UNKNOWN_STATE) === name)
        return inGroup.length === 0 ? null : (
          <Collapsible key={name} title={name} description={`${inGroup.length} ${inGroup.length === 1 ? 'item' : 'items'}`} defaultOpen>
            <Stack gap="sm">
              {inGroup.map((item) => (
                <ItemRow key={item.key} item={item} />
              ))}
            </Stack>
          </Collapsible>
        )
      })}
    </Stack>
  )
}

/** The description sits in its own framed block, apart from the detail around it. */
function Description({ text }: { text: string }) {
  const short = preview(text)
  const open = read(descriptionOpen)
  return (
    <Box direction="column" gap="xs" padding="sm" border radius="md" background="muted">
      <Markdown content={short && !open ? short : text} />
      {short ? (
        <Row>
          <Button variant="ghost" size="sm" onPress={() => set(descriptionOpen, !open)}>
            {open ? 'Show less' : 'Show more'}
          </Button>
        </Row>
      ) : null}
    </Box>
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

function DetailView({ current }: { current: Loaded }) {
  const item = current.item
  const state = read(starts)[current.key]
  const asked = read(confirmation)
  const failedOpen = read(openError)
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
          <Heading level={2}>{`${item.key} ${item.title}`}</Heading>
          {read(links)[item.key]?.agent ? (
            <Row>
              <AgentBadge itemKey={item.key} />
            </Row>
          ) : null}
          <KeyValue
            items={[
              { label: 'State', value: item.stateName ?? 'Unknown' },
              { label: 'Priority', value: item.priority },
              { label: 'Assignees', value: item.assignees.join(', ') || '—' },
              { label: 'Labels', value: item.labels.join(', ') || '—' },
              { label: 'Updated', value: item.updatedAt.slice(0, 16).replace('T', ' ') }
            ]}
          />
          <Row>
            <Button icon="open-external" variant="outline" onPress={() => shell.openExternal(item.url)}>
              Open in Plane
            </Button>
          </Row>
          {item.description ? <Description text={item.description} /> : <Text muted size="sm">No description.</Text>}
          {state?.kind === 'failed' ? (
            <Callout tone="danger" title={state.workspaceId ? 'The agent did not start' : 'Start failed'}>
              {state.error}
            </Callout>
          ) : null}
          {failedOpen ? <Callout tone="danger">{failedOpen}</Callout> : null}
          {asked?.key === item.key ? (
            <Confirmation current={asked} />
          ) : item.stateGroup !== 'unknown' || underWay(state) ? (
            <Row>
              <StartButton key={`start:${item.key}`} item={item} />
            </Row>
          ) : null}
          <EarlierStarts />
        </Stack>
      ) : null}
    </Stack>
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
  return (
    <Stack gap="md">
      {/* The name shrinks and truncates; the buttons keep their size, so a narrow sidebar does not scroll. */}
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
          <IconButton
            icon="refresh"
            label={list?.refreshing ? 'Refreshing' : 'Refresh'}
            disabled={!list || list.refreshing}
            onPress={refresh}
          />
          <Button variant="ghost" size="xs" onPress={disconnect}>
            Disconnect
          </Button>
        </Box>
      </Box>
      {open ? <DetailView current={open} /> : <ListView state={read(items)} />}
    </Stack>
  )
}
