// The Plane panel. It never sees the token after the connect form submits, and never waits on
// the network for the list: the worker answers from its cache and posts `items.changed`.
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Heading,
  IconButton,
  Input,
  KeyValue,
  List,
  ListItem,
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
  type PanelContext
} from 'orca'
import type { Item, ItemDetail } from './plane/map'
import type { ConnectionStatus, ItemsState, OrcaProject, StartState } from './protocol'
import { buildPrompt } from './start'

const SLOW = { timeoutMs: 60_000 }

export const AGENTS = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'none', label: 'Terminal only' }
]
const GROUPS = [
  { group: 'started', label: 'In progress' },
  { group: 'unstarted', label: 'To do' },
  { group: 'backlog', label: 'Backlog' },
  { group: 'unknown', label: 'Unknown state' }
] as const
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
const projects = atom<OrcaProject[] | null>(null)

const hostKind = atom<'cloud' | 'self-hosted'>('cloud')
const serverUrl = atom('')
const slug = atom('')
/** Lives only in this panel run, cleared on submit. */
const token = atom('')
const connecting = atom(false)
const connectError = atom<string | null>(null)

type ItemRef = { key: string; projectId: string }
type Detail = ItemRef & { item: ItemDetail | null; error: string | null }
/** The open item; persisted, so reopening the panel returns to it. */
const opened = atom<ItemRef | null>('plane.open', null, { persist: 'plugin' })
const detail = atom<Detail | null>(null)
const projectId = atom<string | null>(null)
const agent = atom('plane.agent', '', { persist: 'plugin' })
const prompt = atom('')
const startError = atom<string | null>(null)
const openError = atom<string | null>(null)

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function closeItem(): void {
  set(opened, null)
  set(detail, null)
}

async function loadConnected(): Promise<void> {
  const [list, known] = await Promise.all([plugin.request('items.list', undefined), plugin.request('starts.get')])
  set(items, list)
  set(starts, known)
  const ref = read(opened)
  if (ref) await openItem(ref)
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('connection.changed', (next) => {
      set(status, next)
      if (!next.connected) {
        set(items, null)
        set(starts, {})
        closeItem()
      }
    }),
    plugin.on('items.changed', (next) => set(items, next)),
    plugin.on('start.changed', ({ key, state }) => update(starts, (all) => ({ ...all, [key]: state })))
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
  closeItem()
}

async function refresh(): Promise<void> {
  set(items, await plugin.request('items.list', { force: true }))
}

async function openItem(item: ItemRef): Promise<void> {
  set(opened, { key: item.key, projectId: item.projectId })
  set(detail, { key: item.key, projectId: item.projectId, item: null, error: null })
  set(startError, null)
  set(openError, null)
  if (!read(agent)) {
    const fallback = await settings.get('defaultAgent')
    set(agent, typeof fallback === 'string' ? fallback : 'claude')
  }
  const [answer, list] = await Promise.all([
    plugin.request('item.get', { key: item.key, projectId: item.projectId }, SLOW).catch((error: unknown) => ({
      ok: false as const,
      error: message(error)
    })),
    plugin.request('orca.projects').catch(() => ({ projects: [] as OrcaProject[] }))
  ])
  set(projects, list.projects)
  if (!read(projectId) || !list.projects.some((project) => project.id === read(projectId))) {
    set(projectId, list.projects[0]?.id ?? null)
  }
  if (read(detail)?.key !== item.key) return
  if (answer.ok) {
    set(detail, { key: item.key, projectId: item.projectId, item: answer.item, error: null })
    set(prompt, buildPrompt(answer.item))
  } else {
    set(detail, { key: item.key, projectId: item.projectId, item: null, error: answer.error })
  }
}

async function start(key: string): Promise<void> {
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
    if (!answer.accepted) set(startError, answer.reason)
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

function startMarker(state: StartState | undefined) {
  if (!state || state.kind === 'idle') return null
  if (state.kind === 'pending') return <Badge tone="accent">Starting</Badge>
  if (state.kind === 'unknown') return <Badge tone="warning">Checking</Badge>
  if (state.kind === 'created') return <Badge tone="success">Workspace</Badge>
  return <Badge tone="danger">Start failed</Badge>
}

function ListView({ state }: { state: ItemsState | null }) {
  const known = read(starts)
  if (!state || state.completeness === null) {
    return <Skeleton lines={4} label="Loading your items" />
  }
  const badge = COMPLETENESS[state.completeness]
  return (
    <Stack gap="md">
      <Row justify="between">
        <Row gap="xs">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {state.fetchedAt ? (
            <Text muted size="xs">
              updated <RelativeTime at={state.fetchedAt} />
            </Text>
          ) : null}
        </Row>
        <IconButton
          icon="refresh"
          label={state.refreshing ? 'Refreshing' : 'Refresh'}
          disabled={state.refreshing}
          onPress={refresh}
        />
      </Row>
      {state.error ? (
        <Callout tone={state.completeness === 'error' ? 'danger' : 'warning'} title={badge.label}>
          {state.error}
        </Callout>
      ) : null}
      {state.completeness !== 'error' && state.items.length === 0 ? (
        <EmptyState icon="check" title="Nothing open is assigned to you" />
      ) : null}
      {GROUPS.map(({ group, label }) => {
        const entries = state.items.filter((item) => item.stateGroup === group)
        // A List's label is only its accessible name, so the group also gets a visible heading.
        return entries.length === 0 ? null : (
          <Stack key={group} gap="xs">
            <Text size="xs" weight="semibold" muted>
              {`${label} (${entries.length})`}
            </Text>
            <List label={`${label} (${entries.length})`}>
              {entries.map((item) => (
                <ListItem
                  key={item.key}
                  title={`${item.key} ${item.title}`}
                  description={`${item.stateName ?? 'Unknown state'} · ${item.priority} priority`}
                  onPress={() => openItem(item)}
                >
                  {startMarker(known[item.key])}
                </ListItem>
              ))}
            </List>
          </Stack>
        )
      })}
    </Stack>
  )
}

function StartView({ item }: { item: ItemDetail }) {
  const state = read(starts)[item.key] ?? { kind: 'idle' }
  const list = read(projects)
  const error = read(startError)
  const opened = read(openError)
  const workspaceId =
    state.kind === 'created' ? state.workspaceId : state.kind === 'failed' ? state.workspaceId : undefined
  if (workspaceId) {
    return (
      <Card title="Workspace">
        <Stack gap="sm">
          {state.kind === 'failed' ? <Callout tone="danger" title="The agent did not start">{state.error}</Callout> : null}
          {opened ? <Callout tone="danger">{opened}</Callout> : null}
          <Button icon="open-external" onPress={() => openWorkspace(workspaceId)}>
            Open workspace
          </Button>
        </Stack>
      </Card>
    )
  }
  const busy = state.kind === 'pending' || state.kind === 'unknown'
  return (
    <Card title="Start">
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
        <Select label="Agent" value={read(agent)} options={AGENTS} onChange={(value) => set(agent, value)} />
        <Textarea label="Prompt" rows={8} value={read(prompt)} onChange={(value) => set(prompt, value)} />
        {state.kind === 'failed' ? <Callout tone="danger" title="Start failed">{state.error}</Callout> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Button tone="accent" icon="play" disabled={busy || !read(projectId)} onPress={() => start(item.key)}>
          {state.kind === 'pending' ? 'Starting…' : state.kind === 'unknown' ? 'Checking…' : 'Start'}
        </Button>
      </Stack>
    </Card>
  )
}

function DetailView({ current }: { current: Detail }) {
  const item = current.item
  return (
    <Stack gap="md">
      <Row>
        <Button variant="ghost" size="sm" onPress={closeItem}>
          All items
        </Button>
      </Row>
      {current.error ? <Callout tone="danger" title={current.key}>{current.error}</Callout> : null}
      {!item && !current.error ? <Skeleton lines={6} label={`Loading ${current.key}`} /> : null}
      {item ? (
        <Stack gap="md">
          <Heading level={2}>{`${item.key} ${item.title}`}</Heading>
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
          <Stack gap="xs">
            {(item.description || 'No description.').split(/\n{2,}/).map((paragraph, index) => (
              <Text key={String(index)} size="sm">
                {paragraph}
              </Text>
            ))}
          </Stack>
          <StartView item={item} />
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
  return (
    <Stack gap="md">
      <Row justify="between">
        <Text size="sm" muted truncate>
          {`${current.userName} · ${current.slug}`}
        </Text>
        <Button variant="ghost" size="sm" onPress={disconnect}>
          Disconnect
        </Button>
      </Row>
      {open ? <DetailView current={open} /> : <ListView state={read(items)} />}
    </Stack>
  )
}
