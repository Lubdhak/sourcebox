import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/features/documentation/graphql'
import { GraphQLRequestError } from '@/lib/graphql'
import { logger } from '@/lib/logger'
import type { ContentBlock } from '@/types'

/**
 * Loads and edits the selected node's documentation.
 *
 * Separate from `useGraphState` because it has a different lifetime and a different cost.
 * The graph is loaded once and holds every node on the canvas; this holds exactly one
 * node's content, is refetched whenever the selection changes, and is discarded when the
 * inspector closes. Folding it into the graph state would mean either loading every
 * node's content up front or adding per-node loading flags to a structure the canvas
 * re-reads on every drag.
 */

export interface NodeDetailApi {
  detail: api.NodeDetail | null
  loading: boolean
  saving: boolean
  error: string | null
  dismissError: () => void

  saveNodeFields: (fields: {
    title?: string
    nodeType?: string
    summary?: string
  }) => Promise<void>
  /**
   * Writes the whole page as one Markdown block.
   *
   * The node's documentation is edited as a document, so it is saved as one -- the block
   * list that was flattened to build it is replaced rather than diffed. Guessing which
   * paragraph came from which block, after the author has moved text between them, is not
   * a problem with a right answer.
   */
  savePage: (markdown: string) => Promise<boolean>
  /** Re-reads the node from the server, for when a mutation elsewhere changed it. */
  reload: () => void
}

export function useNodeDetail(nodeId: string | null, onNodeChanged?: () => void): NodeDetailApi {
  const [detail, setDetail] = useState<api.NodeDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Cancels the previous request when the selection moves on. Without this, clicking
  // through several nodes quickly can leave a slow response landing after a newer one and
  // showing the wrong node's documentation.
  const inFlight = useRef<AbortController | null>(null)

  const handleError = useCallback((err: unknown, event: string, fallback: string) => {
    if (err instanceof DOMException && err.name === 'AbortError') return

    if (err instanceof GraphQLRequestError && err.isUnauthenticated) {
      window.location.replace('/login')
      return
    }

    setError(err instanceof Error ? err.message : fallback)
    logger.warn(event, { code: err instanceof GraphQLRequestError ? err.code : undefined })
  }, [])

  useEffect(() => {
    if (!nodeId) {
      setDetail(null)
      return
    }

    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    setLoading(true)
    setError(null)

    api
      .fetchNodeDetail(nodeId, { signal: controller.signal })
      .then((node) => setDetail(node))
      .catch((err: unknown) => handleError(err, 'frontend.documentation_node_load_failed', 'Could not load this node.'))
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [handleError, nodeId, reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  const saveNodeFields = useCallback<NodeDetailApi['saveNodeFields']>(
    async (fields) => {
      if (!nodeId) return

      setSaving(true)

      try {
        const node = await api.updateNode({ nodeId, ...fields })

        // The server's version, not the optimistic guess: it may have normalized or
        // rejected part of the change.
        setDetail((current) => (current ? { ...current, ...node } : current))
        // The canvas draws the title, the type and the layer, so it has to be told.
        onNodeChanged?.()
      } catch (err: unknown) {
        handleError(err, 'frontend.documentation_update_node_failed', 'Could not save your change.')
      } finally {
        setSaving(false)
      }
    },
    [handleError, nodeId, onNodeChanged],
  )

  const savePage = useCallback<NodeDetailApi['savePage']>(
    async (markdown) => {
      if (!nodeId) return false

      const existing = [...(detail?.contentBlocks ?? [])].sort((a, b) => a.position - b.position)
      const [first, ...rest] = existing

      setSaving(true)

      try {
        // An emptied page is an empty page, not a block containing nothing.
        if (!markdown.trim()) {
          let blocks: ContentBlock[] = existing
          for (const block of existing) blocks = await api.deleteContentBlock(block.id)

          setDetail((current) => (current ? { ...current, contentBlocks: blocks } : current))
          onNodeChanged?.()

          return true
        }

        // The first block is rewritten -- type included -- rather than dropped and
        // recreated. One row keeps its id, its position and its place in search, and a
        // failure half way through this cannot leave the node with no documentation.
        const { blocks } = await api.upsertContentBlock({
          nodeId,
          ...(first ? { blockId: first.id } : {}),
          blockType: 'MARKDOWN',
          data: { markdown },
          position: 0,
        })

        // Whatever else was on the page has been folded into the text just saved.
        let latest = blocks
        for (const block of rest) latest = await api.deleteContentBlock(block.id)

        setDetail((current) => (current ? { ...current, contentBlocks: latest } : current))
        onNodeChanged?.()

        return true
      } catch (err: unknown) {
        handleError(err, 'frontend.documentation_save_page_failed', 'Could not save this page.')

        return false
      } finally {
        setSaving(false)
      }
    },
    [detail?.contentBlocks, handleError, nodeId, onNodeChanged],
  )

  return {
    detail,
    loading,
    saving,
    error,
    dismissError: useCallback(() => setError(null), []),
    saveNodeFields,
    savePage,
    reload,
  }
}
