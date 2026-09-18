import { Loader2 } from 'lucide-react'
import { impactStats } from '@/features/documentation/deletion/copy'
import { cn } from '@/lib/utils'
import type { DeletionPolicy, NodeDeletionImpact } from '@/types'

/**
 * What this deletion would cost, in three numbers.
 *
 * Impact indicators, not dashboard metrics: they sit below the decision because they are
 * its consequence, and they change when the decision does. Every figure comes from the
 * server — the wording around it is the only thing chosen here.
 *
 * Only this region shows the loading state. Greying out the whole dialog while a radio
 * click is in flight would make choosing an option feel like submitting a form.
 */
export function DeletionImpactSummary({
  impact,
  policy,
  loading,
}: {
  impact: NodeDeletionImpact | null
  policy: DeletionPolicy
  loading: boolean
}) {
  return (
    <section className="space-y-2" aria-busy={loading}>
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Impact
      </h3>

      {/* aria-live so the numbers changing under a radio click is announced, not silent. */}
      <div aria-live="polite">
        {loading || !impact ? (
          <p className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Calculating impact…
          </p>
        ) : (
          <dl className="grid grid-cols-3 gap-2">
            {impactStats(impact, policy).map((stat) => (
              <div
                key={stat.label}
                className={cn(
                  'rounded-md border px-2.5 py-2',
                  stat.tone === 'destructive' && 'border-destructive/30 bg-destructive/5',
                  stat.tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
                  stat.tone === 'neutral' && 'border-border',
                )}
              >
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span
                    className={cn(
                      'block font-mono text-lg leading-none',
                      stat.tone === 'destructive' && 'text-destructive',
                      stat.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {stat.value}
                  </span>
                  <span className="mt-1 block text-[11px] leading-tight text-muted-foreground">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}
