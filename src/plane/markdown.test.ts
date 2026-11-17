import { assert, test } from 'orca/testing'
import { htmlToMarkdown, preview } from './markdown'

test('paragraphs and line breaks', () => {
  assert.equal(htmlToMarkdown('<p>one</p><p>two<br>three<br/>four</p>'), 'one\n\ntwo  \nthree  \nfour')
  assert.equal(htmlToMarkdown(''), '')
  assert.equal(htmlToMarkdown('<p></p><p>  spaced\n  out  </p>'), 'spaced out')
})

test('entities are decoded and Markdown characters in text are escaped', () => {
  assert.equal(
    htmlToMarkdown('<p>a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;&nbsp;e &#8212; &#x41;</p>'),
    'a \\<b\\> & "c" \'d\' e — A'
  )
  assert.equal(htmlToMarkdown('<p>1. not a list *x* [y] _z_ `q`</p>'), '1\\. not a list \\*x\\* \\[y\\] \\_z\\_ \\`q\\`')
  assert.equal(htmlToMarkdown('<p># not a heading</p><p>- not an item</p>'), '\\# not a heading\n\n\\- not an item')
})

test('headings and inline marks', () => {
  assert.equal(
    htmlToMarkdown('<h2>Title</h2><p><strong>bold <em>it</em></strong> <s>gone</s> <code>x()</code></p>'),
    '## Title\n\n**bold *it*** ~~gone~~ `x()`'
  )
  assert.equal(htmlToMarkdown('<p><code>a`b</code></p>'), '``a`b``')
})

test('nested, ordered and task lists', () => {
  assert.equal(
    htmlToMarkdown(
      '<ul><li><p>a</p><ul><li>b</li></ul></li><li>c</li></ul>' +
        '<ol><li>one</li><li>two</li></ol>' +
        '<ul data-type="taskList"><li data-checked="true"><label><input type="checkbox" checked></label><div><p>done</p></div></li>' +
        '<li data-checked="false"><label><input type="checkbox"></label><div><p>todo</p></div></li></ul>'
    ),
    '- a\n  - b\n- c\n\n1. one\n2. two\n\n- [x] done\n- [ ] todo'
  )
})

test('code blocks keep their text and language', () => {
  assert.equal(
    htmlToMarkdown('<pre><code class="language-ts">const a = 1 &lt; 2\n  b *c*</code></pre><p>after</p>'),
    '```ts\nconst a = 1 < 2\n  b *c*\n```\n\nafter'
  )
  assert.equal(htmlToMarkdown('<pre><code>has ``` inside</code></pre>'), '~~~~\nhas ``` inside\n~~~~')
})

test('links keep only http, https and mailto targets; images become their alt text', () => {
  assert.equal(
    htmlToMarkdown('<p><a href="https://x.dev/a b(c)">site</a> <a href="javascript:alert(1)">bad</a> <a href="mailto:a@b.c">mail</a></p>'),
    '[site](https://x.dev/a%20b%28c%29) bad [mail](mailto:a@b.c)'
  )
  assert.equal(htmlToMarkdown('<p><img src="https://x/a.png" alt="diagram"><img src="b.png"></p>'), 'diagram')
})

test('quotes, rules, unknown tags and unclosed markup', () => {
  assert.equal(
    htmlToMarkdown('<blockquote><p>q1</p><p>q2</p></blockquote><hr><p>after <mention-component label="Ada">@Ada</mention-component></p>'),
    '> q1\n>\n> q2\n\n---\n\nafter @Ada'
  )
  assert.equal(htmlToMarkdown('<p>open <strong>bold</p><p>next</p>'), 'open **bold**\n\nnext')
  assert.equal(htmlToMarkdown('loose text <div>block</div> tail'), 'loose text\n\nblock\n\ntail')
})

test('preview: a short description has none', () => {
  assert.equal(preview('First paragraph.\n\n- one\n- two'), null)
})

test('preview: whole blocks within the limits', () => {
  const para = (n: number) => `Paragraph ${n} ${'word '.repeat(20).trim()}.`
  const text = [1, 2, 3, 4, 5, 6].map(para).join('\n\n')
  assert.equal(preview(text), [1, 2, 3, 4].map(para).join('\n\n'))
})

test('preview: a fenced code block with blank lines stays whole', () => {
  const fence = '```\na\n\nb\n```'
  const text = `Intro.\n\n${fence}\n\n${'tail '.repeat(150)}`
  assert.equal(preview(text), `Intro.\n\n${fence}`)
})

test('preview: a too-long first block is cut at a word', () => {
  const long = 'alpha '.repeat(120).trim()
  const cut = preview(long)
  assert.ok(cut && cut.endsWith(' …') && cut.length <= 502, cut ?? 'null')
  assert.ok(long.startsWith(cut.slice(0, -2)))
  const list = Array.from({ length: 20 }, (_, i) => `- item ${i}`).join('\n')
  assert.equal(preview(list), `${Array.from({ length: 10 }, (_, i) => `- item ${i}`).join('\n')} …`)
})

test('preview: a heading never ends it; a long block after it is cut at a word', () => {
  const long = 'alpha '.repeat(120).trim()
  const cut = preview(`## Description\n\n${long}\n\n## Acceptance Criteria\n\n- one`)
  assert.ok(cut && cut.startsWith(`## Description\n\nalpha alpha`) && cut.endsWith(' …') && cut.length <= 502, cut ?? 'null')
  assert.equal(preview(`Intro.\n\n## Details\n\n${long}`), 'Intro.')
  const url = `https://example.com/${'x'.repeat(600)}`
  assert.ok(preview(`## Links\n\n${url}`)?.startsWith('## Links\n\nhttps://example.com/xx'), 'a long word after a heading is cut, not dropped')
  const longHeading = `## ${'Title '.repeat(90).trim()}`
  assert.ok(preview(`${longHeading}\n\n${long}`)?.startsWith('alpha alpha'), 'a heading too long to leave room is left out')
  const headings = Array.from({ length: 5 }, (_, i) => `${'#'.repeat(i + 1)} Heading`).join('\n\n')
  assert.ok(preview(`${headings}\n\n${long}`)?.startsWith('##### Heading\n\nalpha alpha'), 'only the heading above the text shows')
})
