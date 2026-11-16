// Ported from stablyai/orca#29182 at b86a6e39 (MIT, see NOTICE): src/main/plane/plane-comment-html.ts.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' '
}

/** The result is shown as text, never as HTML, so this only has to be readable, not safe. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_match, name: string) => ENTITIES[name])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
