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

/** The text a reader sees, without Markdown syntax. */
// limit: a rough strip of what htmlToMarkdown emits, not a Markdown parser; nested markers keep their inner ones.
function plainText(markdown: string): string {
  const text = markdown
    .replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+](\s+\[[ xX]\])?|\d+[.)])(\s+|$)/gm, '')
    .replace(/(?<!\\)[*_~`]+/g, '')
  return unescape(text).replace(/\s+/g, ' ').trim()
}

const hasChecklist = (markdown: string) => /^\s*[-*]\s+\[[ xX]\]/m.test(markdown)
const hasReference = (markdown: string) =>
  /(?<!\\)`[^`\n]+`/.test(markdown) ||
  /^\s*(```|~~~)/m.test(markdown) ||
  /\b[\w.-]+\/[\w./-]+\.\w+\b/.test(unescape(markdown)) ||
  /https?:\/\//.test(markdown)

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
