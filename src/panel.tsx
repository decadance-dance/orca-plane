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
  type ConnectionStatus,
  type ItemsState,
  KNOWN_AGENTS,
  type LinkView,
  type OrcaProject,
  type StartState
} from './protocol'
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
/** Linked items with their agent state, from the worker (design L3). */
const links = atom<Record<string, LinkView>>({})
/** Counts `links.changed` posts, so a `links.get` answer older than one of them is dropped. */
let linkPosts = 0
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

/** Only the ref's own fields: an atom holds JSON, which has no undefined. */
const refOf = ({ key, projectId }: ItemRef): ItemRef => (projectId ? { key, projectId } : { key })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function closeItem(): void {
  set(opened, null)
  set(detail, null)
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

async function loadConnected(): Promise<void> {
  const posts = linkPosts
  const [list, known, linked] = await Promise.all([
    plugin.request('items.list', undefined),
    plugin.request('starts.get'),
    plugin.request('links.get').catch(() => ({})),
    loadPickers()
  ])
  set(items, list)
  set(starts, known)
  if (posts === linkPosts) set(links, linked)
  const open = read(opened)
  const asked = read(confirming)
  await Promise.all([open ? openItem(open) : null, asked ? askStart(asked) : null])
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('connection.changed', (next) => {
      set(status, next)
      if (!next.connected) {
        set(items, null)
        set(starts, {})
        set(links, {})
        closeItem()
        cancelStart()
      }
    }),
    plugin.on('items.changed', (next) => set(items, next)),
    plugin.on('start.changed', ({ key, state }) => update(starts, (all) => ({ ...all, [key]: state }))),
    plugin.on('links.changed', (next) => {
      linkPosts++
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
  set(links, {})
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

async function openItem(ref: ItemRef): Promise<void> {
  set(opened, refOf(ref))
  set(detail, { ...refOf(ref), item: null, error: null })
  set(openError, null)
  set(descriptionOpen, false)
  const loaded = await fetchDetail(ref)
  if (read(detail)?.key === ref.key) set(detail, loaded)
}

/** The focused Orca workspace belongs to `key` (design L4): show it, unless a Start waits for confirmation. */
function followFocus(key: string | null): void {
  if (!key || read(confirming) || !read(status)?.connected) return
  const listed = read(items)?.items.find((item) => item.key === key)
  void openItem(listed ?? { key })
}

/** Shows the confirmation for a Start, with the prompt built from the item's detail. */
async function askStart(ref: ItemRef): Promise<void> {
  set(confirming, refOf(ref))
  set(confirmation, { ...refOf(ref), item: null, error: null })
  set(startError, null)
  const shown = read(detail)
  const loaded = shown?.key === ref.key && shown.item ? shown : await fetchDetail(ref)
  if (read(confirming)?.key !== ref.key) return
  set(confirmation, loaded)
  if (loaded.item) set(prompt, buildPrompt(loaded.item))
}

async function confirmStart(key: string): Promise<void> {
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
      prompt: read(prompt)
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

function Confirmation({ current }: { current: Loaded }) {
  const project = (read(projects) ?? []).find((entry) => entry.id === read(projectId))
  const error = read(startError)
  return (
    <Card title={`Start ${current.key}`}>
      <Stack gap="sm">
        {current.error ? <Callout tone="danger">{current.error}</Callout> : null}
        {!current.item && !current.error ? <Skeleton lines={3} label={`Loading ${current.key}`} /> : null}
        <Pickers />
        {current.item ? (
          <Stack gap="sm">
            <Text size="sm">
              {`Workspace ${workspaceName(current.item.key, current.item.title)}`}
            </Text>
            <Textarea label="Prompt" rows={8} value={read(prompt)} onChange={(value) => set(prompt, value)} />
          </Stack>
        ) : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Row gap="xs">
          <Button tone="accent" icon="play" disabled={!current.item || !project} onPress={() => confirmStart(current.key)}>
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
    </Stack>
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
          ) : (
            <Row>
              <StartButton key={`start:${item.key}`} item={item} />
            </Row>
          )}
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
