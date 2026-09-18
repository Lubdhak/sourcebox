import { ArrowRight, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { DeletionPolicy, NodeDeletionImpact } from '@/types'

/**
 * The full list, for the person who wants it.
 *
 * Collapsed by default, and that is the load-bearing decision: a bulk deletion of
 * eighteen nodes is a decision about eighteen nodes, not eighteen decisions, so the
 * aggregate numbers are the default reading and this is the appeal. Opening it costs one
 * click and no request — the lists were already in the impact.
 *
 * Height is capped and scrolled rather than truncated with "and 12 more". This is the
 * last screen before documentation is destroyed, so the one thing it must not do is hide
 * the entry that would have changed the person's mind.
 */
export function AffectedNodesPreview({
  impact,
  policy,
}: {
  impact: NodeDeletionImpact
  policy: DeletionPolicy
}) {
  const [open, setOpen] = useState(false)

  const groups = [
    {
      key: 'selected',
      title: 'Selected',
      marker: '●' as const,
      entries: impact.selected.map((entry) => entry.title),
    },
    {
      key: 'inside',
      // Not "moved up to this level": this list runs the whole way down, and only the
      // nodes directly inside the selection change level. The rest are kept in place,
      // inside those.
      title: policy.orphanPolicy === 'DELETE' ? 'Filed inside — will be deleted' : 'Filed inside — kept',
      marker: '○' as const,
      entries: impact.orphans.map((entry) => entry.title),
    },
    {
      key: 'retained',
      title: 'Also filed elsewhere — unaffected',
      marker: '○' as const,
      entries: impact.retained.map((entry) => entry.title),
    },
  ].filter((group) => group.entries.length > 0)

  const hasAnything = groups.length > 0 || impact.references.length > 0
  if (!hasAnything) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1 rounded-sm text-xs font-medium text-primary',
          'hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        )}
      >
        {open ? 'Hide affected nodes' : 'View affected nodes'}
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <ScrollArea className="mt-2 max-h-56 rounded-md border border-border">
          <div className="space-y-3 p-2.5">
            {groups.map((group) => (
              <section key={group.key}>
                <h4 className="text-[11px] font-medium text-foreground">{group.title}</h4>
                <ul className="mt-1 space-y-0.5 border-t border-border pt-1">
                  {group.entries.map((title, index) => (
                    <li
                      key={`${group.key}-${title}-${index}`}
                      className="flex items-baseline gap-1.5 truncate text-xs text-muted-foreground"
                    >
                      <span aria-hidden className="text-[8px]">
                        {group.marker}
                      </span>
                      <span className="truncate">{title}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {impact.references.length > 0 ? (
              <section>
                <h4 className="text-[11px] font-medium text-foreground">
                  {policy.referencePolicy === 'REMOVE' ? 'References removed' : 'References preserved'}
                </h4>
                <ul className="mt-1 space-y-0.5 border-t border-border pt-1">
                  {impact.references.map((reference) => (
                    <li
                      key={reference.id}
                      className="flex items-baseline gap-1.5 truncate text-xs text-muted-foreground"
                    >
                      <span className="truncate">{reference.sourceTitle}</span>
                      {/*
                        The verb as stored, underscores and all -- `deploys_to`, `owned_by`
                        -- because these are the team's own words and tidying them here
                        would make the dialog disagree with the labels on the canvas.
                        `mention` is the one value this side invents, for a prose link.
                      */}
                      <span className="shrink-0 font-mono text-[10px] text-primary">{reference.kind}</span>
                      <ArrowRight className="size-2.5 shrink-0" aria-hidden />
                      <span
                        className={cn(
                          'truncate',
                          policy.referencePolicy === 'REMOVE' && 'line-through',
                        )}
                      >
                        {reference.targetTitle}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  )
}
