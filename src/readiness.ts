// Readiness hints for the Start confirmation (design R1 of start-readiness-hints): fixed local checks
// on the item's Markdown description, advice only, no score.

export type HintId = 'empty' | 'short' | 'no-checklist' | 'no-reference'
export type Hint = { id: HintId; message: string }

const MESSAGES: Record<HintId, string> = {
  empty: 'No description: the agent gets only the title.',
  short: 'Short description: under 200 characters of text.',
  'no-checklist': 'No checklist: nothing says when the work is done.',
  'no-reference': 'No code reference or link: no file, code or URL to start from.'
}
const MIN_TEXT = 200

/** `htmlToMarkdown` escapes Markdown characters in plain text (`my\_file.ts`); this undoes it. */
const unescape = (markdown: string) => markdown.replace(/\\([^A-Za-z0-9\s])/g, '$1')

/** An opening or closing code fence, also inside a quote (`> ```ts`). */
const FENCE = /^\s*(?:>\s?)*\s*(`{3,}|~{3,})(.*)$/

/** The lines outside fenced code blocks: an example in a code block is not a checklist item. */
function prose(markdown: string): string {
  let open = ''
  return markdown
    .split('\n')
    .filter((line) => {
      const [, fence, rest] = FENCE.exec(line) ?? []
      // A fence closes only on the same character, at least as many, with nothing after them.
      if (fence && (!open || (fence[0] === open[0] && fence.length >= open.length && !rest.trim()))) {
        open = open ? '' : fence
        return false
      }
      return !open
    })
    .join('\n')
}

/** The text a reader sees, without Markdown syntax. */
// limit: a rough strip of what htmlToMarkdown emits, not a Markdown parser; nested markers keep their inner ones.
function plainText(markdown: string): string {
  const text = markdown
    .replace(new RegExp(FENCE.source, 'gm'), '')
    // Code is text: keep its length, but nothing the next steps could read as markup.
    .replace(/(?<!\\)(`+)(.+?)\1/g, (_, __, code: string) => code.replace(/^ (.*) $/, '$1').replace(/\S/g, 'x'))
    .replace(/!?\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+](\s+\[[ xX]\])?|\d+[.)])(\s+|$)/gm, '')
    .replace(/(?<!\\)[*_~`]+/g, '')
  return unescape(text).replace(/\s+/g, ' ').trim()
}

const hasChecklist = (markdown: string) => /^\s*[-*]\s+\[[ xX]\]/m.test(prose(markdown))
const hasReference = (markdown: string) =>
  /(?<!\\)`[^`\n]+`/.test(markdown) ||
  new RegExp(FENCE.source, 'm').test(markdown) ||
  /\b[\w.-]+\/[\w./-]+\.\w+\b/.test(unescape(markdown)) ||
  /https?:\/\//i.test(markdown)

export function readiness(description: string): Hint[] {
  const ids: HintId[] = []
  if (!description.trim()) ids.push('empty')
  else {
    if (plainText(description).length < MIN_TEXT) ids.push('short')
    if (!hasChecklist(description)) ids.push('no-checklist')
    if (!hasReference(description)) ids.push('no-reference')
  }
  return ids.map((id) => ({ id, message: MESSAGES[id] }))
}
