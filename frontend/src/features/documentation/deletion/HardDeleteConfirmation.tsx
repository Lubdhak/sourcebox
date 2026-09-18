import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  TYPE_TO_CONFIRM_WORD,
  hardDeleteWarning,
  requiresTypedConfirmation,
} from '@/features/documentation/deletion/copy'
import type { DeletionPolicy, NodeDeletionImpact } from '@/types'

/**
 * The extra friction a hard delete earns.
 *
 * Two levels, not one. Every hard delete gets the warning, because "this cannot be
 * undone" is the fact that distinguishes it from the option above. Only a large one also
 * asks for a typed word: demanding it every time would train people to type it without
 * reading, which removes the protection while keeping the cost.
 *
 * Renders nothing for a soft delete. A banner on the recoverable path would make the
 * warning meaningless on the path that needs it.
 */
export function HardDeleteConfirmation({
  impact,
  policy,
  typed,
  onTypedChange,
}: {
  impact: NodeDeletionImpact
  policy: DeletionPolicy
  typed: string
  onTypedChange: (value: string) => void
}) {
  if (policy.deletionMode !== 'HARD') return null

  const [headline, ...rest] = hardDeleteWarning(impact, policy)
  const needsTyping = requiresTypedConfirmation(impact, policy)

  return (
    <Alert variant="destructive">
      {/* An icon as well as colour, so the warning does not depend on seeing red. */}
      <AlertTriangle aria-hidden />
      <AlertTitle>{headline}</AlertTitle>

      {rest.length > 0 ? (
        <AlertDescription>
          {rest.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </AlertDescription>
      ) : null}

      {needsTyping ? (
        <AlertDescription className="mt-2 space-y-1.5">
          <Label htmlFor="hard-delete-confirm" className="text-xs font-medium">
            Type {TYPE_TO_CONFIRM_WORD} to confirm
          </Label>
          <Input
            id="hard-delete-confirm"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="hard-delete-confirm-hint"
            onChange={(event) => onTypedChange(event.target.value)}
            className="h-8 max-w-48 font-mono text-sm"
          />
          <span id="hard-delete-confirm-hint" className="sr-only">
            This deletion removes {impact.deleteCount} nodes permanently and requires typing{' '}
            {TYPE_TO_CONFIRM_WORD} to proceed.
          </span>
        </AlertDescription>
      ) : null}
    </Alert>
  )
}
