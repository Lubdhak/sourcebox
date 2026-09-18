import { Dialog } from '@base-ui/react/dialog'
import { AlertTriangle, ArrowRight, Copy, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import * as api from '@/features/documentation/graphql'
import type { DeletionImpact, DocumentationNode } from '@/types'

/**
 * The two node operations that must not happen on a single click.
 *
 * Everything else a card offers is either reversible or visible -- a rename can be
 * retyped, a move can be dragged back. Deleting takes documentation that may be the only
 * record of how something works, and copying a subtree can quietly create fifty nodes.
 * Both are cheap to ask about and expensive to guess at, so both ask.
 *
 * They are centred dialogs rather than the side sheets used elsewhere in the space: a
 * sheet slides in beside the thing it is about, which is right for an inspector and wrong
 * for a question that has to be answered before anything else can happen.
 */

function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-sm border border-border bg-popover p-4 text-sm shadow-lg transition duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="text-sm font-medium">{title}</Dialog.Title>
          <Dialog.Description className="text-xs text-muted-foreground">{description}</Dialog.Description>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** "1 relationship", "3 relationships", "no relationships" -- said the way a person would. */
function count(value: number, noun: string): string {
  if (value === 0) return `no ${noun}s`

  return `${value} ${value === 1 ? noun : `${noun}s`}`
}

/**
 * One list of named things the deletion touches.
 *
 * Scrolls rather than truncates, and that is a deliberate reversal of the usual "and 12
 * more": this is the last screen before documentation is destroyed, so the one thing it
 * must not do is hide the entry that would have changed the person's mind. The height cap
 * keeps the dialog on screen; the scroll keeps the list complete.
 */
function Section({
  title,
  note,
  warning,
  children,
}: {
  title: string
  note?: string
  warning?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-sm border border-border">
      <p className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs font-medium">
        {warning ? <AlertTriangle className="size-3.5 text-amber-600" aria-hidden /> : null}
        {title}
      </p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto px-2.5 py-1.5 text-xs text-muted-foreground">
        {children}
      </ul>
      {note ? <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  )
}

/**
 * Deleting a node, having first said what that would take with it.
 *
 * The impact is read from the server rather than counted from the canvas, and that is the
 * whole reason this dialog is worth a round trip: the canvas holds one level, so it can
 * see neither how deep the node goes nor which of the things inside it also live
 * somewhere else. A confirmation that guessed would either alarm people about nodes that
 * are not going anywhere or fail to mention the forty that are.
 *
 * Everything is named, not counted. "2 relationships would go with it" is a sentence
 * nobody can act on -- the two might be an incidental `related_to`, or they might be the
 * only record that the payment gateway calls this service, and those are opposite
 * decisions. So each edge is written out with both ends and its verb, and each node
 * inside is listed by title. The counts stay as a summary above them, for the case where
 * the list is long enough that only its size matters.
 *
 * Two ways out, because "delete this" has two honest meanings. Keeping the contents moves
 * them up into whatever contained the node, which is what someone tidying a grouping
 * wants; deleting everything is what someone retiring a service wants. Neither is a safe
 * default for the other, so both are offered and neither is preselected.
 */
export function DeleteNodeDialog({
  node,
  open,
  onOpenChange,
  onConfirm,
}: {
  node: DocumentationNode | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (cascade: boolean) => void
}) {
  const [impact, setImpact] = useState<DeletionImpact | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !node) return

    const controller = new AbortController()
    setImpact(null)
    setError(null)

    api
      .fetchDeletionImpact(node.id, { signal: controller.signal })
      .then(setImpact)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Could not work out what this would affect.')
      })

    return () => controller.abort()
  }, [node, open])

  if (!node) return null

  const inside = impact?.descendants ?? []
  const retained = impact?.retained ?? []
  const edges = impact?.relationships ?? []

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${node.title}”?`}
      description={
        impact
          ? `${count(impact.blockCount, 'content block')} and ${count(impact.relationshipCount, 'relationship')} would go with it.`
          : 'Working out what this would affect…'
      }
    >
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {impact === null && !error ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : null}

      {edges.length > 0 ? (
        <Section title={`${count(edges.length, 'relationship')} removed`}>
          {edges.map((edge) => (
            <li key={edge.id} className="flex items-baseline gap-1 truncate">
              <span className={edge.sourceTitle === node.title ? 'font-medium text-foreground' : ''}>
                {edge.sourceTitle}
              </span>
              {/*
                The verb is written as stored, underscores and all. These are the team's
                own words -- `deploys_to`, `owned_by` -- and prettifying them would make
                the dialog disagree with the edge labels on the canvas.
              */}
              <span className="shrink-0 font-mono text-[10px] text-brand-600">{edge.relationshipType}</span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className={edge.targetTitle === node.title ? 'font-medium text-foreground' : ''}>
                {edge.targetTitle}
              </span>
            </li>
          ))}
        </Section>
      ) : null}

      {inside.length > 0 ? (
        <Section
          title={`${count(inside.length, 'node')} inside it`}
          note={
            impact && impact.descendantRelationshipCount + impact.descendantBlockCount > 0
              ? `Deleting all of it also removes ${count(impact.descendantBlockCount, 'content block')} and ${count(impact.descendantRelationshipCount, 'relationship')} of theirs.`
              : undefined
          }
          warning
        >
          {inside.map((descendant) => (
            <li key={descendant.id} className="truncate">
              <span>{descendant.title}</span>
            </li>
          ))}
        </Section>
      ) : null}

      {retained.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {retained.length === 1 ? (
            <>
              <span className="font-medium text-foreground">{retained[0]?.title}</span> also lives elsewhere, so it
              stays either way.
            </>
          ) : (
            <>
              {retained.length} nodes inside it also live elsewhere, so they stay either way.
            </>
          )}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>

        {inside.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onConfirm(false)
              onOpenChange(false)
            }}
          >
            Delete only this node
          </Button>
        ) : null}

        <Button
          variant="destructive"
          size="sm"
          disabled={impact === null}
          onClick={() => {
            onConfirm(inside.length > 0)
            onOpenChange(false)
          }}
        >
          <Trash2 className="size-3.5" />
          {inside.length > 0 ? `Delete all ${inside.length + 1}` : 'Delete'}
        </Button>
      </div>

      {inside.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          “Delete only this node” moves what is inside up into{' '}
          {node.parents?.[0] ? `“${node.parents[0].title}”` : 'the top of the space'}.
        </p>
      ) : null}
    </Modal>
  )
}

/**
 * Copying a node: with or without what is inside it.
 *
 * Only asked when there is something inside to ask about -- a leaf node is copied on the
 * click, because the question would have one answer. The distinction matters because the
 * two are different amounts of work being duplicated: a service template someone wants
 * to fill in again, or a whole documented subsystem.
 */
export function DuplicateNodeDialog({
  node,
  open,
  onOpenChange,
  onConfirm,
}: {
  node: DocumentationNode | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (includeChildren: boolean) => void
}) {
  if (!node) return null

  const childCount = node.childCount ?? 0

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Duplicate “${node.title}”?`}
      description={`It contains ${childCount} ${childCount === 1 ? 'node' : 'nodes'}. The copy lands beside the original.`}
    >
      <p className="text-xs text-muted-foreground">
        Either way the copy keeps this node's own content blocks. Relationships to nodes outside the copy are
        not carried over — a copy should not claim the original's dependencies until somebody says so.
      </p>

      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onConfirm(false)
            onOpenChange(false)
          }}
        >
          Just this node
        </Button>
        <Button
          size="sm"
          onClick={() => {
            onConfirm(true)
            onOpenChange(false)
          }}
        >
          <Copy className="size-3.5" />
          With everything inside
        </Button>
      </div>
    </Modal>
  )
}
