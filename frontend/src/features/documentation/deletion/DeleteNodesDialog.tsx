import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { AffectedNodesPreview } from '@/features/documentation/deletion/AffectedNodesPreview'
import { DeletionImpactSummary } from '@/features/documentation/deletion/DeletionImpactSummary'
import { HardDeleteConfirmation } from '@/features/documentation/deletion/HardDeleteConfirmation'
import { PolicySelector } from '@/features/documentation/deletion/PolicySelector'
import {
  DELETION_MODE_OPTIONS,
  ERRORS,
  ORPHAN_POLICY_OPTIONS,
  TYPE_TO_CONFIRM_WORD,
  confirmLabel,
  dialogDescription,
  dialogTitle,
  insideSectionDescription,
  requiresTypedConfirmation,
} from '@/features/documentation/deletion/copy'
import { useNodeDeletion } from '@/features/documentation/deletion/useNodeDeletion'
import type { DeletionMode, OrphanPolicy } from '@/types'

/**
 * The deletion dialog. One node or twenty — there is no other one.
 *
 * There is deliberately no `DeleteSingleNodeDialog` and no `DeleteBulkNodesDialog`. A
 * single deletion is a selection of one, so the only thing that varies is the wording,
 * and the wording is derived from `nodeIds.length`. Two components would have meant two
 * places for the policy semantics to drift apart, which is exactly what happened before:
 * one dialog offered a cascade choice and the other did not, so the same key press meant
 * different things depending on how the user had selected.
 *
 * The reading order is the decision order, top to bottom:
 *
 *   what am I deleting  →  soft or hard  →  what about connected nodes
 *                       →  what is the impact  →  confirm
 *
 * Nothing technical sits above the decision. The graph vocabulary this is built on —
 * cascade, orphan, dangling reference, containment edge — appears nowhere on screen; see
 * `copy.ts`, which owns every sentence.
 *
 * It calculates nothing. Every number is from `nodesDeletionImpact`, re-requested on each
 * policy change, and the confirm button is unavailable whenever that number is in flight.
 * That is what makes the preview and the deletion the same operation.
 */
export function DeleteNodesDialog({
  nodeIds,
  open,
  onOpenChange,
  /** Titles for the nodes, when the caller has them. Only used to name a single deletion. */
  titles,
  onDeleted,
}: {
  nodeIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  titles?: Record<string, string>
  onDeleted?: (deletedIds: string[]) => void
}) {
  const deletion = useNodeDeletion({
    nodeIds,
    enabled: open,
    onDeleted: (deleted) => {
      onDeleted?.(deleted)
      onOpenChange(false)
    },
  })

  const [typed, setTyped] = useState('')

  // A fresh dialog every time it opens. Without this, reopening on a different selection
  // would show the previous one's policy and a half-typed confirmation.
  useEffect(() => {
    if (open) return

    deletion.reset()
    setTyped('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const { impact, policy, status, error, conflict } = deletion
  const count = nodeIds.length
  const firstTitle = count === 1 ? titles?.[nodeIds[0] ?? ''] : undefined

  const calculating = status === 'loading'
  const deleting = status === 'deleting'
  const typedSatisfied =
    !impact || !requiresTypedConfirmation(impact, policy) || typed.trim() === TYPE_TO_CONFIRM_WORD

  // Only `ready` may delete, which is the state machine's one hard rule: a policy change
  // clears the impact, so there is no route from a stale preview to a destructive action.
  const canDelete = status === 'ready' && impact !== null && typedSatisfied

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0">
        <div className="p-5 pb-4">
          <DialogHeader>
            <DialogTitle>{dialogTitle(count, firstTitle)}</DialogTitle>
            <DialogDescription>{dialogDescription(count)}</DialogDescription>
          </DialogHeader>
        </div>

        <Separator />

        {/*
          The body scrolls, the header and footer do not. A deletion of a deeply nested
          node can list a lot; the confirm button must stay reachable without scrolling
          past it, and the title must stay visible so it is always clear what is at stake.
        */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>{ERRORS.impact.title}</AlertTitle>
              <AlertDescription>
                <span className="block">{ERRORS.impact.body}</span>
                <span className="mt-1 block opacity-80">{error}</span>
                <Button
                  variant="outline"
                  size="xs"
                  className="mt-2"
                  onClick={deletion.refreshImpact}
                >
                  <RotateCcw />
                  {ERRORS.impact.action}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {conflict ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden />
              <AlertTitle>{ERRORS.conflict.title}</AlertTitle>
              <AlertDescription>{ERRORS.conflict.body}</AlertDescription>
            </Alert>
          ) : null}

          <PolicySelector<DeletionMode>
            section="Deletion type"
            value={policy.deletionMode}
            options={DELETION_MODE_OPTIONS}
            disabled={deleting}
            onChange={(deletionMode) => {
              setTyped('')
              deletion.setPolicy({ deletionMode })
            }}
          />

          <PolicySelector<OrphanPolicy>
            section="Nodes inside"
            description={insideSectionDescription(count)}
            value={policy.orphanPolicy}
            options={ORPHAN_POLICY_OPTIONS}
            disabled={deleting}
            onChange={(orphanPolicy) => {
              setTyped('')
              deletion.setPolicy({ orphanPolicy })
            }}
          />

          <DeletionImpactSummary impact={impact} policy={policy} loading={calculating} />

          {impact && !calculating ? (
            <>
              <AffectedNodesPreview impact={impact} policy={policy} />
              <HardDeleteConfirmation
                impact={impact}
                policy={policy}
                typed={typed}
                onTypedChange={setTyped}
              />
            </>
          ) : null}
        </div>

        <Separator />

        <DialogFooter className="p-5 pt-4">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canDelete || deleting}
            onClick={() => void deletion.confirm()}
          >
            {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            {deleting ? 'Deleting…' : confirmLabel(count, policy, firstTitle)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
