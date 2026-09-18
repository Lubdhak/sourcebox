import type { DeletionPolicy, NodeDeletionImpact } from '@/types'

/**
 * Every sentence the deletion dialog says, in one file.
 *
 * The wire values are enums — `SOFT`, `KEEP`, `PRESERVE` — and none of them appears on
 * screen. Nor does the vocabulary the graph is actually built from: there is no
 * "cascade", no "dangling reference", no "orphan" in the primary copy, because those
 * name the implementation rather than the consequence, and the consequence is the only
 * thing the person clicking has an opinion about.
 *
 * Keeping it here rather than inline in JSX is what makes the wording reviewable as
 * wording, and what stops the same idea being phrased two ways in two sections.
 */

/** "18 nodes", "1 node" — said the way a person would. */
export function countNodes(value: number): string {
  return `${value} ${value === 1 ? 'node' : 'nodes'}`
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`
}

/**
 * The title. A single deletion names the thing; a bulk deletion counts it.
 *
 * A name is only used when it is short enough to read inside a heading — a 200-character
 * title would push the close button off the dialog.
 */
export function dialogTitle(count: number, firstTitle?: string): string {
  if (count === 1 && firstTitle && firstTitle.length <= 48) return `Delete “${firstTitle}”`
  if (count === 1) return 'Delete this node'

  return `Delete ${countNodes(count)}`
}

export function dialogDescription(count: number): string {
  return count === 1
    ? 'Choose what should happen to this node and anything connected to it.'
    : 'Choose what should happen to these nodes and anything connected to them.'
}

export const DELETION_MODE_OPTIONS = [
  {
    value: 'SOFT' as const,
    title: 'Soft delete',
    lines: ['Keep these nodes recoverable.', 'References remain available.'],
  },
  {
    value: 'HARD' as const,
    title: 'Hard delete',
    lines: ['Permanently remove these nodes.', 'References to them will be removed.'],
  },
]

export const ORPHAN_POLICY_OPTIONS = [
  {
    value: 'KEEP' as const,
    title: 'Keep disconnected nodes',
    lines: [
      'Keep them even if they lose their parent or incoming reference.',
      'They move up to the current level, in place of what is deleted.',
    ],
  },
  {
    value: 'DELETE' as const,
    title: 'Delete disconnected nodes',
    lines: ['These nodes will be deleted as part of this operation.'],
  },
]

/**
 * The impact statistics, worded for the policy in force.
 *
 * The same 43 references are "preserved" or "removed" depending on the choice above, and
 * saying only "43 references affected" in both cases would make the radio buttons look
 * decorative. Every number comes from the server; this only decides the noun.
 */
export function impactStats(
  impact: NodeDeletionImpact,
  policy: DeletionPolicy,
): { value: number; label: string; tone: 'neutral' | 'warning' | 'destructive' }[] {
  const stats: { value: number; label: string; tone: 'neutral' | 'warning' | 'destructive' }[] = [
    { value: impact.selectedCount, label: 'selected', tone: 'neutral' },
    {
      value: impact.referenceCount,
      label: policy.referencePolicy === 'REMOVE' ? 'references removed' : 'references preserved',
      tone: policy.referencePolicy === 'REMOVE' && impact.referenceCount > 0 ? 'warning' : 'neutral',
    },
  ]

  if (policy.orphanPolicy === 'DELETE' && impact.additionalDeleteCount > 0) {
    stats.push({
      value: impact.deleteCount,
      label: 'nodes will be deleted',
      tone: 'destructive',
    })
  } else {
    stats.push({
      value: impact.orphanCount,
      label: impact.orphanCount === 1 ? 'disconnected node' : 'disconnected nodes',
      tone: impact.orphanCount > 0 ? 'warning' : 'neutral',
    })
  }

  return stats
}

/**
 * The primary button. It has to communicate reversibility before it is pressed, because
 * that is the one thing that cannot be learned afterwards.
 */
export function confirmLabel(
  count: number,
  policy: DeletionPolicy,
  firstTitle?: string,
): string {
  if (policy.deletionMode === 'HARD') {
    return count === 1 ? 'Permanently delete' : `Permanently delete ${countNodes(count)}`
  }

  if (count === 1 && firstTitle && firstTitle.length <= 32) return `Delete “${firstTitle}”`

  return count === 1 ? 'Delete node' : `Delete ${countNodes(count)}`
}

/** The escalating warning shown once hard delete is chosen. */
export function hardDeleteWarning(impact: NodeDeletionImpact, policy: DeletionPolicy): string[] {
  const lines = ['This cannot be undone.']

  if (policy.orphanPolicy === 'DELETE' && impact.additionalDeleteCount > 0) {
    lines.push(
      `This will permanently remove ${countNodes(impact.selectedCount)} and ${plural(
        impact.additionalDeleteCount,
        'connected node',
      )}.`,
    )
  }

  if (impact.referenceCount > 0) {
    lines.push('References to these nodes will also be removed.')
  }

  return lines
}

/**
 * Whether to demand the user type a word before a hard delete goes through.
 *
 * Reserved for deletions large enough that a misclick is expensive and a moment's pause
 * is cheap. Asking for it on every hard delete would train people to type it without
 * reading, which is worse than not asking.
 */
export const TYPE_TO_CONFIRM_THRESHOLD = 10
export const TYPE_TO_CONFIRM_WORD = 'DELETE'

export function requiresTypedConfirmation(
  impact: NodeDeletionImpact,
  policy: DeletionPolicy,
): boolean {
  return policy.deletionMode === 'HARD' && impact.deleteCount >= TYPE_TO_CONFIRM_THRESHOLD
}

export const ERRORS = {
  impact: {
    title: "Couldn't calculate deletion impact.",
    body: 'No changes have been made.',
    action: 'Try again',
  },
  conflict: {
    title: 'The nodes changed while you were reviewing this deletion.',
    body: 'Review the updated impact before continuing.',
  },
  execution: {
    title: "Couldn't delete these nodes.",
    body: 'No changes have been made.',
    action: 'Try again',
  },
} as const
