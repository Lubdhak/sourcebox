import { Check, ChevronDown, Layers, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type DepthLayer = {
  id: string
  index: number
  name: string
  nodeCount: number
}

/**
 * The space's depth ladder, as a menu.
 *
 * This was a rail down the left of the canvas, and a rail is the wrong price for it. The
 * ladder is consulted occasionally -- to filter to a rung, to rename one, to add one when
 * a system turns out to decompose further than expected -- and it was charging fourteen
 * rems of permanent width for that, taken from the two things the page is actually for:
 * the canvas and the page being read next to it.
 *
 * It still doubles as the filter, because those are the same question asked twice:
 * picking a rung shows what lives at that depth, and two controls for one question is one
 * too many.
 */
export function DepthMenu({
  layers,
  activeLayerId,
  busy,
  editable = true,
  onSelect,
  onAdd,
  onRename,
  onRemove,
}: {
  layers: DepthLayer[]
  activeLayerId: string | null
  busy: boolean
  /** Filtering stays available to everyone; changing the ladder does not. */
  editable?: boolean
  onSelect: (layerId: string | null) => void
  onAdd: () => void
  onRename: (layerId: string, name: string) => void
  onRemove: (layerId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const container = useRef<HTMLDivElement>(null)

  const active = layers.find((layer) => layer.id === activeLayerId) ?? null

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      // Stopped here, or Escape would close the menu *and* ascend a level on the canvas.
      event.stopPropagation()
      setOpen(false)
      setEditingId(null)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="relative" ref={container}>
      <Button
        variant={active ? 'secondary' : 'outline'}
        size="sm"
        aria-label="Filter by depth"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Layers className="size-4" />
        <span className="hidden sm:inline">{active ? `${active.index} · ${active.name}` : 'All depths'}</span>
        <ChevronDown className="size-3" />
      </Button>

      {open ? (
        <div
          role="listbox"
          aria-label="Depth"
          className="absolute right-0 z-30 mt-1 w-64 rounded-sm border border-border bg-popover p-1 shadow-lg"
        >
          <Row
            label="All depths"
            selected={activeLayerId === null}
            onSelect={() => {
              onSelect(null)
              setOpen(false)
            }}
          />

          {layers.map((layer) =>
            editable && editingId === layer.id ? (
              <form
                key={layer.id}
                className="flex items-center gap-1 p-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  onRename(layer.id, draft.trim() || layer.name)
                  setEditingId(null)
                }}
              >
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="h-7 text-xs"
                  aria-label={`Rename ${layer.name}`}
                  autoFocus
                />
                <Button type="submit" size="icon" variant="ghost" className="size-7" aria-label="Save name">
                  <Check className="size-3" />
                </Button>
              </form>
            ) : (
              <Row
                key={layer.id}
                label={`${layer.index} · ${layer.name}`}
                hint={`${layer.nodeCount}`}
                selected={layer.id === activeLayerId}
                onSelect={() => {
                  onSelect(layer.id)
                  setOpen(false)
                }}
                onRename={
                  editable
                    ? () => {
                        setEditingId(layer.id)
                        setDraft(layer.name)
                      }
                    : null
                }
                onRemove={editable ? () => onRemove(layer.id) : null}
                removeHint={
                  layer.nodeCount > 0
                    ? `Remove this depth. Its ${layer.nodeCount} nodes are kept, without a depth.`
                    : 'Remove this depth'
                }
              />
            ),
          )}

          {editable ? (
            <div className="mt-1 border-t border-border pt-1">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onAdd} disabled={busy}>
                <Plus className="size-3" />
                Add a depth
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Row({
  label,
  hint,
  selected,
  onSelect,
  onRename,
  onRemove,
  removeHint,
}: {
  label: string
  hint?: string
  selected: boolean
  onSelect: () => void
  onRename?: (() => void) | null
  onRemove?: (() => void) | null
  removeHint?: string
}) {
  return (
    <div className="group/row flex items-center">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        // Renaming in place, on a double click, is how the rail worked and is worth
        // keeping: a rung's name is a label on a diagram, and it gets corrected often.
        onDoubleClick={() => onRename?.()}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent',
          selected && 'font-medium',
        )}
      >
        <Check className={cn('size-3 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{hint}</span> : null}
      </button>

      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          title={removeHint}
          className="mr-1 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
        </button>
      ) : null}
    </div>
  )
}
