// Which agents Start offers (design D8). Orca has no host API for installed agents, so the worker
// asks the person's login shell which of the known agents' commands exist on this computer.
import { type AgentChoice, KNOWN_AGENTS } from './protocol'

// The worker runs on Node; the plugin's type setup has no Node typings.
declare const process: { env: Record<string, string | undefined>; platform: string }
type ExecFile = (
  file: string,
  args: string[],
  options: { timeout: number },
  done: (error: Error | null, stdout: string) => void
) => void

async function runLoginShell(script: string): Promise<string> {
  if (process.platform === 'win32') throw new Error('no POSIX login shell')
  const { execFile } = (await import('node:child_process' as string)) as { execFile: ExecFile }
  return new Promise((resolve, reject) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lc', script], { timeout: 5_000 }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout))
    )
  })
}

/** Swapped by tests. */
export const shell = { run: runLoginShell }

const ALL: AgentChoice[] = KNOWN_AGENTS.map(({ value, label }) => ({ value, label }))

async function find(): Promise<AgentChoice[]> {
  // Fixed text from the table: nothing from outside reaches the shell. Without `exit 0` the
  // status of the last `command -v` would fail the whole check.
  const script = KNOWN_AGENTS.map(({ command }) => `command -v ${command} >/dev/null 2>&1 && echo ${command}`).join('; ') + '; exit 0'
  try {
    const found = new Set((await shell.run(script)).split('\n').map((line) => line.trim()))
    const agents = KNOWN_AGENTS.filter(({ command }) => found.has(command)).map(({ value, label }) => ({ value, label }))
    return agents.length > 0 ? agents : ALL
  } catch {
    return ALL
  }
}

/** Checks once per worker run; agents are seldom installed while Orca runs. */
export function agentFinder(): () => Promise<AgentChoice[]> {
  let found: Promise<AgentChoice[]> | null = null
  return () => (found ??= find())
}
