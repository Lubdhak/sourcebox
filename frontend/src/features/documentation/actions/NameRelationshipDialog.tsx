import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DocumentationNode } from '@/types'

/**
 * A mandatory dialog for naming a relationship before it is created.
 *
 * Shown whenever the user drags a connection from one node to another on the canvas.
 * The relationship type must be provided — the dialog cannot be confirmed with an
 * empty name. Pressing Escape or Cancel discards the pending connection.
 *
 * Why mandatory: a graph of unlabelled arrows is harder to read than one whose edges
 * say something. "calls", "depends_on", "owns", "produces" each carry meaning that
 * "→" does not, and the author is the only person who can supply it at creation time.
 */
export function NameRelationshipDialog({
  open,
  sourceNode,
  targetNode,
  onConfirm,
  onCancel,
}: {
  open: boolean
  sourceNode: DocumentationNode | null
  targetNode: DocumentationNode | null
  onConfirm: (relationshipType: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset the name each time the dialog opens for a new connection.
  useEffect(() => {
    if (open) {
      setName('')
      // Autofocus after the next paint so the user can type immediately.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      const trimmed = name.trim()
      if (!trimmed) return
      onConfirm(trimmed)
    },
    [name, onConfirm],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      }
    },
    [onCancel],
  )

  if (!open) return null

  const sourceName = sourceNode?.title ?? 'Node'
  const targetName = targetNode?.title ?? 'Node'

  return (
    /*
      Overlay. Clicking outside the dialog cancels the connection, the same as pressing
      Escape — incomplete connections should not linger.
    */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="w-full max-w-sm rounded-md border border-border bg-popover p-5 shadow-lg"
        onKeyDown={handleKeyDown}
      >
        <h2 className="text-sm font-semibold">Name this connection</h2>

        <p className="mt-1 text-xs text-muted-foreground">
          How does <span className="font-medium text-foreground">{sourceName}</span> relate to{' '}
          <span className="font-medium text-foreground">{targetName}</span>?
        </p>

        <form className="mt-4" onSubmit={handleSubmit}>
          <Input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. calls, depends_on, owns, publishes…"
            aria-label="Relationship name"
            className="text-sm"
          />

          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Use a short verb or phrase that describes the direction from{' '}
            <span className="font-medium">{sourceName}</span> to{' '}
            <span className="font-medium">{targetName}</span>.
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Connect
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
