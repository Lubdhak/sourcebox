/**
 * `@`-mentions: how one node's page points at another.
 *
 * This file owns the format, and the format is the interesting decision. A mention is
 * stored as an ordinary Markdown link to a fragment:
 *
 *   [@Payment Service](#node-42)
 *
 * which means it survives every layer it has to pass through without special-casing any
 * of them. Markdown parses it, DOMPurify keeps it -- a custom `node:` scheme would be
 * stripped as unknown, and raw HTML would be too -- an anchor renders it, and the
 * renderer recognises the prefix to turn a click into in-app navigation rather than a
 * page load. Pasted somewhere else it degrades to text that still names the node, which
 * is the right failure: a broken link is worse than a plain one.
 *
 * Recognising the `@` as it is typed is the editor's job rather than this file's -- the
 * document model knows where a word begins, and a regular expression over a whole page
 * only guessed.
 */

export const MENTION_HREF_PREFIX = '#node-'

export function mentionMarkdown(node: { id: string; title: string }): string {
  // Brackets in a title would close the link text early, so they are escaped rather than
  // stripped: the title belongs to whoever wrote it.
  const label = node.title.replace(/([[\]])/g, '\\$1')

  return `[@${label}](${MENTION_HREF_PREFIX}${node.id})`
}

/** The node id in a mention's href, or null for an ordinary link. */
export function mentionNodeId(href: string): string | null {
  if (!href.startsWith(MENTION_HREF_PREFIX)) return null

  const id = href.slice(MENTION_HREF_PREFIX.length)

  return /^\d+$/.test(id) ? id : null
}
