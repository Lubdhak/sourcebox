import { Dialog } from '@base-ui/react/dialog'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DocumentationNode } from '@/types'

/**
 * Node operations that must not happen on a single click.
 *
 * Copying a subtree can quietly create fifty nodes, which is cheap to ask about and
 * expensive to guess at, so it asks.
 *
 * Deletion used to live here too, as two separate dialogs -- one for a single node and
 * one for a selection. Both are gone: deletion is now one component over one backend
 * service, in `features/documentation/deletion`. Keeping a second implementation here
 * would have meant two answers to "what does deleting this do", which is the thing that
 * flow exists to prevent.
 *
 * A centred dialog rather than the side sheets used elsewhere in the space: a sheet
 * slides in beside the thing it is about, which is right for an inspector and wrong for a
 * question that has to be answered before anything else can happen.
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
