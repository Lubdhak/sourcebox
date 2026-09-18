import { Handle, Position } from '@xyflow/react'
import { ArrowUpRight } from 'lucide-react'
import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { DocumentationNode } from '@/types'

/**
 * Where a neighbour sits relative to the level being looked at.
 *
 * Colour carries this rather than the label alone, because the question a reader asks
 * about an edge leaving the level is directional -- "does this reach up out of the system
 * or down into a detail?" -- and answering it should not require reading four cards.
 */
export type NeighborTone = 'above' | 'alongside' | 'below' | 'unknown'

const TONES: Record<NeighborTone, { card: string; text: string; stroke: string; label: string }> = {
  above: {
    card: 'border-amber-400/70 bg-amber-50/70 dark:bg-amber-950/30',
    text: 'text-amber-700 dark:text-amber-400',
    stroke: 'var(--color-amber-500)',
    label: 'higher up',
  },
  alongside: {
    card: 'border-sky-400/70 bg-sky-50/70 dark:bg-sky-950/30',
    text: 'text-sky-700 dark:text-sky-400',
    stroke: 'var(--color-sky-500)',
    label: 'same depth',
  },
  below: {
    card: 'border-violet-400/70 bg-violet-50/70 dark:bg-violet-950/30',
    text: 'text-violet-700 dark:text-violet-400',
    stroke: 'var(--color-violet-500)',
    label: 'deeper in',
  },
  unknown: {
    card: 'border-border bg-muted/60',
    text: 'text-muted-foreground',
    stroke: 'var(--color-muted-foreground)',
    label: 'elsewhere',
  },
}

export function neighborStroke(tone: NeighborTone): string {
  return TONES[tone].stroke
}

export interface NeighborCardData extends Record<string, unknown> {
  node: DocumentationNode
  layerName?: never  // removed — nodes no longer have a layer
  tone: NeighborTone
  /** The verbs that connect this node to the current level, deduped. */
  verbs: string[]
  onOpen: (node: DocumentationNode) => void
}

/**
 * A node that lives somewhere else, drawn because something here connects to it.
 *
 * The canvas shows one level of containment at a time, which is what makes it readable,
 * but relationships ignore levels: a module three deep inside one service calls another
 * service outright. Dropping those edges would draw the architecture as less connected
 * than it is, and drawing the far end like an ordinary card would claim it is part of
 * this level. So it is a ghost -- smaller, faint, dashed, colour-coded by the direction
 * it lies in -- and clicking it leaves for the level it really belongs to.
 *
 * It is a button rather than a draggable node on purpose. Its position here is a drawing
 * decision made by the canvas, not a coordinate anyone chose, so there is nothing to
 * persist and moving it would mean nothing.
 */
export const NeighborCard = memo(function NeighborCard({ data }: { data: NeighborCardData }) {
  const { node, tone, verbs, onOpen } = data
  const palette = TONES[tone]

  return (
    <div className="relative">
      {/* Non-connectable and invisible, but mounted: an edge has to anchor somewhere. */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />

      <button
        type="button"
        onClick={() => onOpen(node)}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn(
          'nodrag flex w-44 flex-col gap-0.5 rounded-sm border border-dashed px-2 py-1.5 text-left opacity-80 transition-opacity hover:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
          palette.card,
        )}
        title={`Go to ${node.title}`}
      >
        <span className={cn('flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide', palette.text)}>
          {palette.label}
          <ArrowUpRight className="size-2.5" aria-hidden />
        </span>
        <span className="truncate text-xs font-medium leading-tight">{node.title}</span>
        {verbs.length > 0 ? (
          <span className="truncate font-mono text-[9px] text-muted-foreground">
            {verbs.map((verb) => verb.replace(/_/g, ' ')).join(', ')}
          </span>
        ) : null}
      </button>

      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
    </div>
  )
})
