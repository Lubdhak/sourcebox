import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/features/documentation/graphql'
import { GraphQLRequestError } from '@/lib/graphql'
import { logger } from '@/lib/logger'
import type { DeletionPolicy, NodeDeletionImpact } from '@/types'

/**
 * The deletion domain, as one hook.
 *
 * Owns the small state machine the dialog runs on and nothing else — no graph traversal,
 * no counting, no guessing what a policy would do. Every number it exposes came from the
 * server, because the server is where the one implementation of "what does deleting this
 * mean" lives (`Documentation::NodeDeletion`). A second implementation here would be a
 * second answer.
 *
 *   idle → loading → ready → deleting → done
 *                 ↘ error        ↘ conflict → loading
 *
 * The rule that makes it safe: `ready` requires a current impact, and the impact is
 * discarded the moment a policy changes. So there is no path from a stale preview to a
 * deletion, which is the failure this whole flow exists to prevent.
 */

export type DeletionStatus = 'idle' | 'loading' | 'ready' | 'deleting' | 'done' | 'error'

export interface NodeDeletionApi {
  status: DeletionStatus
  policy: DeletionPolicy
  setPolicy: (next: Partial<DeletionPolicy>) => void
  /** Null until the first impact arrives, and while a policy change is in flight. */
  impact: NodeDeletionImpact | null
  /** Set when the impact could not be calculated. Blocks deletion. */
  error: string | null
  /** Set when the graph moved under the user. The impact shown is the fresh one. */
  conflict: boolean
  /** Recalculates for the current policy. Safe to call repeatedly. */
  refreshImpact: () => void
  /** Resolves with the deleted ids, or null when nothing was deleted. */
  confirm: () => Promise<string[] | null>
  /** Returns the dialog to its opening state, for reuse across selections. */
  reset: () => void
}

const DEFAULT_POLICY: DeletionPolicy = {
  deletionMode: 'SOFT',
  referencePolicy: 'PRESERVE',
  orphanPolicy: 'KEEP',
}

export function useNodeDeletion({
  nodeIds,
  enabled,
  onDeleted,
}: {
  nodeIds: string[]
  /** False while the dialog is closed, so a closed dialog costs no requests. */
  enabled: boolean
  onDeleted?: (deletedIds: string[]) => void
}): NodeDeletionApi {
  const [policy, setPolicyState] = useState<DeletionPolicy>(DEFAULT_POLICY)
  const [impact, setImpact] = useState<NodeDeletionImpact | null>(null)
  const [status, setStatus] = useState<DeletionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  // Cancels the previous calculation when the policy moves on. Without it a slow earlier
  // response can land after a newer one and show numbers for options no longer selected.
  const inFlight = useRef<AbortController | null>(null)

  // A stable key for the selection, so the effect below does not re-run on every render
  // just because the caller passed a fresh array literal.
  const selectionKey = nodeIds.join(',')

  const reportFailure = useCallback((err: unknown, event: string, fallback: string) => {
    if (err instanceof DOMException && err.name === 'AbortError') return false

    if (err instanceof GraphQLRequestError && err.isUnauthenticated) {
      window.location.replace('/login')
      return false
    }

    logger.warn(event, {
      code: err instanceof GraphQLRequestError ? err.code : undefined,
    })
    setError(err instanceof Error ? err.message : fallback)

    return true
  }, [])

  const load = useCallback(async () => {
    if (!enabled || nodeIds.length === 0) return

    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    // The impact is cleared rather than kept while loading, which is what makes a stale
    // preview unconfirmable: `confirm` has nothing to send until the new one arrives.
    setImpact(null)
    setStatus('loading')
    setError(null)

    try {
      const next = await api.fetchNodesDeletionImpact(
        { nodeIds, ...policy },
        { signal: controller.signal },
      )

      if (controller.signal.aborted) return

      setImpact(next)
      setStatus('ready')
    } catch (err: unknown) {
      if (reportFailure(err, 'frontend.documentation_deletion_impact_failed', 'Could not calculate the impact.')) {
        setStatus('error')
      }
    }
  }, [enabled, nodeIds, policy, reportFailure, selectionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // One recalculation per (selection, policy) pair. `selectionKey` rather than `nodeIds`
  // so an equal-but-new array does not trigger a request.
  useEffect(() => {
    if (!enabled) return

    void load()

    return () => inFlight.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectionKey, policy.deletionMode, policy.referencePolicy, policy.orphanPolicy])

  /**
   * Changing the mode moves the reference policy with it, unless the user has said
   * otherwise in the same breath.
   *
   * Preserving references to rows that no longer exist would leave links to nothing, and
   * rewriting references to rows that are coming back would lose them for good. The
   * server derives the same default; this keeps the UI honest about what will happen.
   */
  const setPolicy = useCallback((next: Partial<DeletionPolicy>) => {
    setConflict(false)
    setPolicyState((current) => {
      const merged = { ...current, ...next }

      if (next.deletionMode && !next.referencePolicy) {
        merged.referencePolicy = next.deletionMode === 'HARD' ? 'REMOVE' : 'PRESERVE'
      }

      return merged
    })
  }, [])

  const confirm = useCallback(async (): Promise<string[] | null> => {
    // The guard that enforces "no deletion without a current impact".
    if (!impact || status !== 'ready') return null

    setStatus('deleting')
    setError(null)

    try {
      const result = await api.deleteNodes({
        nodeIds,
        ...policy,
        expectedDigest: impact.digest,
      })

      // Not an error: the request was fine and the answer is "look again". The server
      // sends the recalculated impact so the dialog can redraw in place.
      if (result.changed) {
        setConflict(true)
        setImpact(result.impact)
        setStatus(result.impact ? 'ready' : 'error')

        return null
      }

      const deleted = result.deletedNodeIds ?? []
      setStatus('done')
      onDeleted?.(deleted)

      return deleted
    } catch (err: unknown) {
      if (reportFailure(err, 'frontend.documentation_delete_nodes_failed', 'Could not delete these nodes.')) {
        // Back to `ready`, not `error`: the impact is still valid and the user can retry
        // without re-reviewing everything.
        setStatus('ready')
      }

      return null
    }
  }, [impact, nodeIds, onDeleted, policy, reportFailure, status])

  const reset = useCallback(() => {
    inFlight.current?.abort()
    setPolicyState(DEFAULT_POLICY)
    setImpact(null)
    setStatus('idle')
    setError(null)
    setConflict(false)
  }, [])

  return {
    status,
    policy,
    setPolicy,
    impact,
    error,
    conflict,
    refreshImpact: useCallback(() => void load(), [load]),
    confirm,
    reset,
  }
}
