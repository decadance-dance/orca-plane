// Plane's description HTML to GitHub-flavoured Markdown (design D11). Orca's `Markdown` sanitizes
// what it draws, so this only has to keep the structure readable, not make the HTML safe.

type El = { tag: string; attrs: string; children: Node[] }
type Node = El | string

const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr', 'col', 'source', 'meta', 'link'])
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr'
])
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
const escape = (text: string) => text.replace(/[\\`*_[\]<>~]/g, '\\$&')
/** A line that Markdown would read as a heading, list item or quote stays text. */
const escapeStart = (line: string) => line.replace(/^(\d+)([.)])(?=\s)/, '$1\\$2').replace(/^([#+-])(?=\s|$)/, '\\$1')
const isEl = (node: Node): node is El => typeof node !== 'string'

function attr(el: El, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(el.attrs)
  return match ? decode(match[1] ?? match[2] ?? match[3] ?? '') : ''
}

/** A forgiving tree: an end tag closes everything it encloses, a stray one is ignored. */
function parse(html: string): Node[] {
  const root: El = { tag: '#root', attrs: '', children: [] }
  const stack = [root]
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+|<)/g)) {
    const top = stack[stack.length - 1]
    if (match[5] !== undefined) top.children.push(match[5])
    if (!match[2]) continue
    const tag = match[2].toLowerCase()
    if (match[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    const el: El = { tag, attrs: match[3], children: [] }
    top.children.push(el)
    if (!VOID.has(tag) && !match[4]) stack.push(el)
  }
  return root.children
}

function textOf(nodes: Node[]): string {
  return nodes.map((node) => (isEl(node) ? (node.tag === 'br' ? '\n' : textOf(node.children)) : decode(node))).join('')
}

/** Wraps in `mark`, keeping surrounding spaces outside, which Markdown needs. */
function wrap(mark: string, inner: string): string {
  const [, before, body, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner) ?? ['', '', inner, '']
  return body ? `${before}${mark}${body}${mark}${after}` : inner
}

function code(text: string): string {
  const flat = text.replace(/\s+/g, ' ')
  if (!flat.includes('`')) return `\`${flat}\``
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : ''
  return `\`\`${pad}${flat}${pad}\`\``
}

function inline(nodes: Node[]): string {
  return nodes
    .map((node) => {
      if (!isEl(node)) return escape(decode(node.replace(/\s+/g, ' ')))
      switch (node.tag) {
        case 'br':
          return '  \n'
        case 'strong':
        case 'b':
          return wrap('**', inline(node.children))
        case 'em':
        case 'i':
          return wrap('*', inline(node.children))
        case 's':
        case 'del':
        case 'strike':
          return wrap('~~', inline(node.children))
        case 'code':
          return code(textOf(node.children))
        case 'img':
          return escape(attr(node, 'alt'))
        case 'input':
          return ''
        case 'a': {
          const text = inline(node.children).trim()
          const href = attr(node, 'href').trim()
          if (!/^(https?:|mailto:)/i.test(href)) return text
          const url = href.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
          return `[${text || escape(url)}](${url})`
        }
        default:
          return inline(node.children)
      }
    })
    .join('')
}

function list(el: El): string {
  const ordered = el.tag === 'ol'
  let n = Number(attr(el, 'start')) || 1
  return el.children
    .filter((child): child is El => isEl(child) && child.tag === 'li')
    .map((li) => {
      const checked = attr(li, 'data-checked')
      const marker = ordered ? `${n++}. ` : checked === 'true' ? '- [x] ' : checked === 'false' ? '- [ ] ' : '- '
      const pad = ' '.repeat(ordered ? marker.length : 2)
      // Tight: an item's paragraphs and nested lists sit on consecutive lines.
      return blocks(li.children)
        .join('\n')
        .split('\n')
        .map((line, index) => (index === 0 ? marker + line : line ? pad + line : line))
        .join('\n')
    })
    .join('\n')
}

function block(el: El): string {
  const heading = /^h([1-6])$/.exec(el.tag)
  if (heading) {
    const text = inline(el.children).replace(/\s+/g, ' ').trim()
    return text ? `${'#'.repeat(Number(heading[1]))} ${text}` : ''
  }
  switch (el.tag) {
    case 'ul':
    case 'ol':
      return list(el)
    case 'blockquote':
      return blocks(el.children)
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    case 'pre': {
      const inner = el.children.find((child): child is El => isEl(child) && child.tag === 'code')
      const language = inner ? (/language-([\w+-]+)/.exec(attr(inner, 'class'))?.[1] ?? '') : ''
      const text = textOf(inner ? inner.children : el.children).replace(/\n$/, '')
      const fence = text.includes('```') ? '~~~~' : '```'
      return `${fence}${language}\n${text}\n${fence}`
    }
    case 'hr':
      return '---'
    case 'table':
    case 'thead':
    case 'tbody':
      return blocks(el.children).join('  \n')
    case 'tr':
      return el.children
        .filter(isEl)
        .map((cell) => inline(cell.children).trim())
        .join(' | ')
    default:
      return blocks(el.children).join('\n\n')
  }
}

/** Block children each become a block; runs of inline content between them become paragraphs. */
function blocks(nodes: Node[]): string[] {
  const out: string[] = []
  let run: Node[] = []
  const flush = () => {
    const text = inline(run)
      .trim()
      .replace(/\n +/g, '\n')
      .split('\n')
      .map(escapeStart)
      .join('\n')
    if (text) out.push(text)
    run = []
  }
  for (const node of nodes) {
    if (isEl(node) && BLOCK.has(node.tag)) {
      flush()
      const text = block(node)
      if (text) out.push(text)
    } else {
      run.push(node)
    }
  }
  flush()
  return out
}

export function htmlToMarkdown(html: string): string {
  return blocks(parse(html)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

const PREVIEW_CHARS = 500
const PREVIEW_LINES = 10
const fits = (text: string) => text.length <= PREVIEW_CHARS && text.split('\n').length <= PREVIEW_LINES

/** The collapsed part of a long description: its first whole blocks within the limits, or `null` when it all fits. */
export function preview(markdown: string): string | null {
  if (fits(markdown)) return null
  const blocks: string[] = []
  for (const part of markdown.split(/\n[ \t]*\n/)) {
    const last = blocks.length - 1
    // A blank line inside a fenced code block does not end the block.
    if (last >= 0 && (blocks[last].match(/^\s*```/gm)?.length ?? 0) % 2 === 1) blocks[last] += `\n\n${part}`
    else blocks.push(part)
  }
  const isHeading = (block: string) => /^#{1,6}\s[^\n]*$/.test(block)
  let count = 0
  while (count < blocks.length && fits(blocks.slice(0, count + 1).join('\n\n'))) count++
  // A heading belongs with the text under it, so the preview never ends on one.
  while (count > 0 && isHeading(blocks[count - 1])) count--
  if (count > 0) return blocks.slice(0, count).join('\n\n')
  // Nothing whole fits: the start of the first block of text, under its own heading when that leaves room for the text.
  const body = blocks.findIndex((block) => !isHeading(block))
  const above = body > 0 ? blocks[body - 1] : ''
  const first =
    body < 0 ? blocks[0] : above.length > 0 && above.length <= PREVIEW_CHARS / 2 ? `${above}\n\n${blocks[body]}` : blocks[body]
  const start = first.split('\n').slice(0, PREVIEW_LINES).join('\n')
  return `${start.length > PREVIEW_CHARS ? start.slice(0, PREVIEW_CHARS - 2).replace(/[ \t]+\S*$/, '') : start} …`
}
