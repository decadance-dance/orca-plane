import { assert, test } from 'orca/testing'
import { agentFinder, shell } from './agents'
import { KNOWN_AGENTS } from './protocol'

const ALL = KNOWN_AGENTS.map(({ value, label }) => ({ value, label }))

async function withShell(run: (script: string) => Promise<string>, check: () => Promise<void>) {
  const real = shell.run
  shell.run = run
  try {
    await check()
  } finally {
    shell.run = real
  }
}

test('offers the known agents whose command the login shell finds, once per run', async () => {
  const scripts: string[] = []
  await withShell(
    async (script) => {
      scripts.push(script)
      return 'claude\ncursor-agent\n'
    },
    async () => {
      const find = agentFinder()
      assert.deepEqual(await find(), [
        { value: 'claude', label: 'Claude Code' },
        { value: 'cursor', label: 'Cursor' }
      ])
      await find()
      assert.equal(scripts.length, 1)
      // The script is fixed text built from the table: every known command, nothing else.
      for (const agent of KNOWN_AGENTS) assert.match(scripts[0], new RegExp(`command -v ${agent.command} `))
      // A missing last command must not make the shell fail, or every agent would be offered.
      assert.match(scripts[0], /; exit 0$/)
    }
  )
})

test('nothing found or a failed check offers every known agent', async () => {
  await withShell(async () => '\n', async () => assert.deepEqual(await agentFinder()(), ALL))
  await withShell(
    async () => {
      throw new Error('timed out')
    },
    async () => assert.deepEqual(await agentFinder()(), ALL)
  )
})
