import { assert, test } from 'orca/testing'
import { readiness } from './readiness'

const ids = (description: string) => readiness(description).map((hint) => hint.id)
const LONG = `The login page waits for the session check before it draws anything. ${'It should draw the form first and check the session in the background. '.repeat(2)}`
const CHECKLIST = '- [ ] The form draws before the session check ends\n- [x] Measured on a cold cache'

test('an empty description gets only the empty hint', () => {
  assert.deepEqual(ids(''), ['empty'])
  assert.deepEqual(ids('  \n\n '), ['empty'])
  assert.equal(readiness('')[0].message, 'No description: the agent gets only the title.')
})

test('a short sentence gets short, no checklist and no reference', () => {
  assert.deepEqual(ids('Login is slow.'), ['short', 'no-checklist', 'no-reference'])
})

test('short counts the text, not the markup', () => {
  const link = `[${'a'.repeat(150)}](https://example.com/${'x'.repeat(100)})`
  assert.ok(ids(link).includes('short'), 'a long URL does not make the text long')
  assert.ok(!ids(`${LONG}\n\n${CHECKLIST}`).includes('short'))
  assert.ok(ids(`## ${'*'.repeat(100)}\n\n${'-'.repeat(100)}`).includes('short'), 'markup only')
})

test('no checklist: a plain list is not a checklist; a checked or open box is', () => {
  assert.ok(ids(`${LONG}\n\n- one\n- two`).includes('no-checklist'))
  assert.ok(!ids(`${LONG}\n\n- [ ] one`).includes('no-checklist'))
  assert.ok(!ids(`${LONG}\n\n  * [X] one`).includes('no-checklist'))
})

test('a reference: a path, inline code, a code block or a link', () => {
  assert.ok(ids(LONG).includes('no-reference'))
  assert.ok(!ids(`${LONG} See src/auth/login.ts.`).includes('no-reference'), 'a path')
  assert.ok(!ids(`${LONG} See src/my\\_auth/log\\_in.ts.`).includes('no-reference'), 'a path the converter escaped')
  assert.ok(!ids(`${LONG} Call \`checkSession()\`.`).includes('no-reference'), 'inline code')
  assert.ok(!ids(`${LONG}\n\n\`\`\`ts\nawait check()\n\`\`\``).includes('no-reference'), 'a code block')
  assert.ok(!ids(`${LONG} [trace](https://example.com/trace)`).includes('no-reference'), 'a link')
  assert.ok(ids(`${LONG} An escaped \\\`tick\\\` and and/or words.`).includes('no-reference'), 'escaped backticks and a bare slash are not references')
})

test('a ready ticket gets no hints', () => {
  assert.deepEqual(ids(`${LONG}The code is in \`src/auth/login.ts\`.\n\n${CHECKLIST}`), [])
})
