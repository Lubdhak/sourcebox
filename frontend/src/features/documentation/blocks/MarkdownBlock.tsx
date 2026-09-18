import { useCallback, useMemo, useRef } from 'react'
import { renderMarkdown } from '@/features/documentation/blocks/renderMarkdown'
import type { RemoteAuthor } from '@/features/documentation/collaboration/useCollaborativeDocument'
import { mentionNodeId } from '@/features/documentation/inspector/mentions'
import type { ContentBlockData } from '@/types'

/** How long the flash CSS animation runs -- see `.remote-update-flash` and
 * `.remote-update-flash-name` in application.css, which this matches exactly so the
 * name badge disappears at the same moment the colour finishes fading rather than one
 * lingering after the other. The classes are removed after this so a later, unrelated
 * re-render does not find them still attached to a wrapper `dangerouslySetInnerHTML`
 * happens to reuse. */
const REMOTE_FLASH_MS = 3_000

/**
 * Lucide's `link-2` glyph, redrawn by hand.
 *
 * The reader's copy is built by mutating real DOM nodes after `dangerouslySetInnerHTML`
 * runs, not by rendering JSX -- see the class comment on the ref callback below for why --
 * so the icon has to be markup, not a component. Copied from `lucide-react` rather than
 * invented, so a paragraph's link button and the toolbar's look like the same icon,
 * because they are.
 */
const LINK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/>' +
  '<line x1="8" x2="16" y1="12" y2="12"/></svg>'

/**
 * Markdown, rendered as HTML.
 *
 * Parsing and sanitizing live in `renderMarkdown`, which the editor shares. What is left
 * here is what the reader's copy needs and the editor's does not: the anchors are
 * rewritten to open safely, a link to another node in this space is turned into
 * navigation rather than a fragment jump, and -- when `nodeId` is given -- every
 * paragraph gets a button of its own to be linked to.
 */
export function MarkdownBlock({
  nodeId,
  data,
  remoteAuthor = null,
  onNavigateToNode,
}: {
  /**
   * Whose page this is. Given, every top-level block gets a "copy link" button that
   * writes `?node=<nodeId>&block=<n>` -- see `useGraphState`'s `selectNode` for the other
   * half of the address, and `InspectorPanel`'s `PageView` for what opening one does.
   * Omitted in tests and anywhere else a block does not belong to an addressable page.
   */
  nodeId?: string
  data: ContentBlockData
  /**
   * See `usePageBody`'s field of the same name. Read only to attribute the flash below --
   * omitted (null) wherever a caller has no collaborative session to ask, which also
   * correctly never flashes anything, since there is then no "someone else" a change
   * could be attributed to.
   */
  remoteAuthor?: RemoteAuthor | null
  /** Given, mentions of other nodes become navigation instead of dead fragment links. */
  onNavigateToNode?: (nodeId: string) => void
}) {
  const source = typeof data.markdown === 'string' ? data.markdown : ''

  const html = useMemo(() => renderMarkdown(source), [source])

  /*
   * Text content per top-level block, as of the last time the ref callback ran -- null
   * until then, which is what keeps the very first render from flashing every block on
   * the page the instant it opens. Compared by position rather than by any sturdier
   * identity for the same reason `data-block-index` already is: nothing sturdier exists
   * for a block that is Markdown text, not a row with an id.
   */
  const previousBlockText = useRef<string[] | null>(null)

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

        /*
         * One wrapper, and one button, per top-level block -- built here rather than by
         * `renderMarkdown`, which knows Markdown and sanitizing and nothing about this
         * page's address. Each original element (a heading, a paragraph, a table, a
         * fenced snippet) is moved inside an otherwise invisible `<div>` rather than
         * having the button appended into it directly: a `<button>` dropped straight
         * into a `<ul>` or a `<table>` is invalid markup and renders as a stray bullet or
         * an extra row, where a sibling wrapper costs nothing the block's own layout can
         * see.
         *
         * `data-block-index` is what a link is built from and what `PageView` scrolls to
         * -- position in this array, because nothing sturdier exists. There is no
         * per-paragraph id anywhere in storage: content is Markdown text, and a block
         * survives only as long as nothing is added or removed above it. A link that
         * outlives the next edit is not promised; one copied and opened a minute later
         * reliably is, which is the case this exists for.
         */
        if (nodeId) {
          for (const [index, block] of [...element.children].entries()) {
            if (block.hasAttribute('data-block-index')) continue

            const wrapper = document.createElement('div')
            wrapper.className = 'group/block relative'
            wrapper.dataset.blockIndex = String(index)
            block.replaceWith(wrapper)
            wrapper.appendChild(block)
            wrapper.appendChild(copyLinkButton(nodeId, index))
          }
        }

        /*
         * Flashes whichever blocks' text differs from the last pass -- which, on this
         * component, can only mean a collaborator's edit just arrived: a reader has no
         * editor of their own open here to have caused it (see usePageBody's
         * `remoteAuthor` for the other half of that reasoning). Read after the wrapping
         * above so a block's own text, not the button just added beside it, is what gets
         * compared and coloured.
         */
        const blocks = [...element.children] as HTMLElement[]
        const currentText = blocks.map((block) => block.textContent ?? '')

        if (previousBlockText.current) {
          const previous = previousBlockText.current
          blocks.forEach((block, index) => {
            if (previous[index] === undefined || previous[index] === currentText[index]) return

            if (remoteAuthor) block.style.setProperty('--flash-color', remoteAuthor.color)
            else block.style.removeProperty('--flash-color')

            // The name badge is positioned absolutely against the block, which needs a
            // positioning context of its own to land against rather than the nearest
            // one up the tree (typically the whole panel). `nodeId`'s wrapper already
            // has one (`relative`, added above); anything else gets it here instead of
            // silently mispositioning the one time this runs without a wrapper.
            if (getComputedStyle(block).position === 'static') block.style.position = 'relative'

            // Force a reflow before re-adding the classes, so a block that changes again
            // before the previous flash finished restarts the animation instead of the
            // browser treating "already has this class" as nothing to redo.
            block.classList.remove('remote-update-flash')
            void block.offsetWidth
            block.classList.add('remote-update-flash')
            window.setTimeout(() => block.classList.remove('remote-update-flash'), REMOTE_FLASH_MS)

            const existingBadge = block.querySelector<HTMLElement>(':scope > .remote-update-flash-name')
            existingBadge?.remove()
            if (remoteAuthor) {
              const badge = document.createElement('span')
              badge.className = 'remote-update-flash-name'
              badge.textContent = remoteAuthor.name
              block.appendChild(badge)
              window.setTimeout(() => badge.remove(), REMOTE_FLASH_MS)
            }
          })
        }

        previousBlockText.current = currentText
      }}
    />
  )
}

/**
 * The button itself: hidden until the block it sits on is hovered or the button is
 * tabbed to, then a small chain link at the top corner. Revealed by a CSS rule scoped to
 * `.group\/block`, not by a React hover handler, because there is one of these per block
 * on a long page and a hundred `useState`s for "am I hovered" is a hundred re-renders for
 * a fact CSS already tracks for free.
 */
function copyLinkButton(nodeId: string, blockIndex: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', 'Copy link to this paragraph')
  button.title = 'Copy link to this paragraph'
  button.innerHTML = LINK_ICON_SVG
  button.className =
    'copy-block-link absolute -top-1 -right-1 grid size-5 place-items-center rounded-xs ' +
    'border border-border bg-popover text-muted-foreground opacity-0 shadow-sm transition-opacity ' +
    'hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 ' +
    'focus-visible:ring-ring group-hover/block:opacity-100'

  button.addEventListener('click', (event) => {
    // Not a link: the address this copies is the page the button already sits on, so
    // there is nothing under it worth navigating to and every reason to stay put.
    event.preventDefault()
    event.stopPropagation()

    const url = new URL(window.location.href)
    url.searchParams.set('node', nodeId)
    url.searchParams.set('block', String(blockIndex))

    void navigator.clipboard?.writeText(url.toString()).then(() => {
      // Feedback in the title and a class, not in component state -- this button was
      // never rendered by React and has no state of its own to update.
      const original = button.title
      button.title = 'Link copied'
      button.classList.add('copy-block-link--copied')
      window.setTimeout(() => {
        button.title = original
        button.classList.remove('copy-block-link--copied')
      }, 1500)
    })
  })

  return button
}
