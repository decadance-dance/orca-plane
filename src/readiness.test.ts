import { assert, test } from 'orca/testing'
import { htmlToMarkdown } from './plane/markdown'
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

// Review round 1 on PR #45: each case runs Plane HTML through the converter first.
const CHECKLIST_HTML = '<ul data-type="taskList"><li data-checked="false"><p>The form draws first</p></li></ul>'
const LONG_HTML = `<p>${LONG}</p>`
const fromHtml = (html: string) => ids(htmlToMarkdown(html))

test('a checklist line inside a fenced code example is not a checklist item', () => {
  assert.ok(fromHtml(`${LONG_HTML}<pre><code>- [ ] Example syntax</code></pre>`).includes('no-checklist'))
  assert.ok(fromHtml(`${LONG_HTML}<blockquote><pre><code>- [x] quoted example</code></pre></blockquote>`).includes('no-checklist'))
})

test('an uppercase scheme and a code block inside a quote are references', () => {
  assert.deepEqual(fromHtml(`${LONG_HTML}${CHECKLIST_HTML}<p><a href="HTTPS://example.com/trace">Trace</a></p>`), [])
  assert.deepEqual(fromHtml(`${LONG_HTML}${CHECKLIST_HTML}<blockquote><pre><code>await check()</code></pre></blockquote>`), [])
})

test('the length counts code text literally and drops a link target behind an escaped label', () => {
  assert.ok(!fromHtml(`<p>${'a'.repeat(190)} <code>user_name</code></p>`).includes('short'), '200 visible characters')
  assert.ok(fromHtml(`<p>${'a'.repeat(189)} <code>user_name</code></p>`).includes('short'), '199 visible characters')
  assert.ok(fromHtml(`<p><a href="https://example.com/${'x'.repeat(200)}">Trace [1]</a></p>`).includes('short'))
})

// Review round 2 on PR #45.
test('a shorter tilde line inside a four-tilde fence does not close it', () => {
  const block = '<pre><code>has ``` inside\n~~~\n- [ ] Example syntax</code></pre>'
  assert.deepEqual(fromHtml(`${LONG_HTML}<pre><code>has \`\`\` inside\n~~~\nExample syntax</code></pre>${CHECKLIST_HTML}`), [])
  assert.ok(fromHtml(`${LONG_HTML}${block}`).includes('no-checklist'))
})

test('inline code at the start of a line is not read as a heading', () => {
  assert.ok(!fromHtml(`<p><code># ${'a'.repeat(198)}</code></p>`).includes('short'))
})
