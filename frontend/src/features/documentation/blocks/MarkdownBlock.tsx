import { useCallback, useMemo } from 'react'
import { renderMarkdown } from '@/features/documentation/blocks/renderMarkdown'
import { mentionNodeId } from '@/features/documentation/inspector/mentions'
import type { ContentBlockData } from '@/types'

/**
 * Markdown, rendered as HTML.
 *
 * Parsing and sanitizing live in `renderMarkdown`, which the editor shares. What is left
 * here is what the reader's copy needs and the editor's does not: the anchors are
 * rewritten to open safely, and a link to another node in this space is turned into
 * navigation rather than a fragment jump.
 */
export function MarkdownBlock({
  data,
  onNavigateToNode,
}: {
  data: ContentBlockData
  /** Given, mentions of other nodes become navigation instead of dead fragment links. */
  onNavigateToNode?: (nodeId: string) => void
}) {
  const source = typeof data.markdown === 'string' ? data.markdown : ''

  const html = useMemo(() => renderMarkdown(source), [source])

  /*
   * Mentions are intercepted rather than followed.
   *
   * A mention is written as a link to `#node-42`, which an anchor would treat as a
   * fragment on the current URL -- a no-op that scrolls nowhere. One delegated listener
   * on the container catches it instead and selects the node, which moves the canvas and
   * the inspector together. Delegation rather than a listener per link because the HTML
   * is replaced wholesale on every edit.
   */
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onNavigateToNode) return

      const anchor = (event.target as HTMLElement).closest('a[href]')
      const nodeId = anchor ? mentionNodeId(anchor.getAttribute('href') ?? '') : null
      if (!nodeId) return

      event.preventDefault()
      onNavigateToNode(nodeId)
    },
    [onNavigateToNode],
  )

  if (!html) return <p className="text-sm italic text-muted-foreground">Empty</p>

  return (
    <div
      className="documentation-markdown text-sm leading-relaxed"
      onClick={onClick}
      // Sanitized immediately above. See the class comment.
      dangerouslySetInnerHTML={{ __html: html }}
      ref={(element) => {
        if (!element) return

        // `noopener` is the load-bearing part: without it a link opened in a new tab can
        // reach back through `window.opener` and navigate this page. Applied here rather
        // than in the sanitizer config because DOMPurify allows the attributes but does
        // not add them.
        //
        // A mention stays in this tab: it points at a node in this space, and opening a
        // second copy of the application to show it would be absurd.
        for (const anchor of element.querySelectorAll('a[href]')) {
          if (mentionNodeId(anchor.getAttribute('href') ?? '')) continue

          anchor.setAttribute('target', '_blank')
          anchor.setAttribute('rel', 'noopener noreferrer nofollow')
        }
      }}
    />
  )
}
