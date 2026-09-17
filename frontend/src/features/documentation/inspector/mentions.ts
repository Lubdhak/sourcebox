import type { TextEdit } from '@/features/documentation/inspector/markdownCommands'

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
 * The typing half is here too, and it is deliberately permissive about spaces. Node
 * titles are prose ("Leader and Followers"), so a picker that closed at the first space
 * could never find most of them; it closes on a second consecutive space, a newline, or
 * Escape instead.
 */

export const MENTION_HREF_PREFIX = '#node-'

/** Long enough for any real title, short enough that stray prose stops querying. */
const MAX_QUERY_LENGTH = 48

export interface MentionQuery {
  /** Index of the `@`. */
  start: number
  /** The caret, which is where the query ends. */
  end: number
  query: string
}

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

/**
 * The mention being typed immediately before the caret, if there is one.
 *
 * Returns null rather than an empty query when the caret is not in a mention, so the
 * caller can use the presence of a result as "the picker should be open".
 */
export function mentionQueryAt(value: string, caret: number): MentionQuery | null {
  const at = value.lastIndexOf('@', caret - 1)
  if (at === -1) return null

  // An `@` has to start a word. Otherwise every email address in a page opens a picker.
  const preceding = at === 0 ? '' : value[at - 1]
  if (preceding && !/[\s([{>*_~-]/.test(preceding)) return null

  const query = value.slice(at + 1, caret)

  if (query.length > MAX_QUERY_LENGTH) return null
  // A newline ends the attempt, and so does a gap wide enough to be ordinary prose.
  if (/[\n\r]/.test(query) || /\s\s/.test(query)) return null
  // Already a completed mention or a link: the caret is inside markup, not a query.
  if (/[[\]()]/.test(query)) return null

  return { start: at, end: caret, query }
}

/**
 * Replaces the typed `@query` with a mention, and leaves the caret after it.
 *
 * The trailing space is intentional: a mention is nearly always followed by more
 * sentence, and without it the next keystroke reads as part of the link's label to anyone
 * scanning the source.
 */
export function applyMention(range: MentionQuery, node: { id: string; title: string }): TextEdit {
  const insert = `${mentionMarkdown(node)} `
  const caret = range.start + insert.length

  return { start: range.start, end: range.end, insert, select: { start: caret, end: caret } }
}
