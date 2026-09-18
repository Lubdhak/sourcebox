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
 * "Disconnected" used to be here, and it was the same mistake one word further on. The
 * product has no disconnected state to land in: what is filed inside a deleted node is
 * re-attached to whatever contained that node, which is the level the card was on — so
 * the nodes move up and take its place. The dialog said they would be cut loose, which
 * was a worse outcome than the one it was describing, and it was the first thing a
 * reader had to decide whether to believe.
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
    title: 'Keep the nodes inside',
    lines: [
      'The nodes directly inside move up to this level, taking the place of what is deleted.',
      'Anything nested deeper stays where it is, inside them.',
    ],
  },
  {
    value: 'DELETE' as const,
    title: 'Delete the nodes inside',
    lines: [
      'Everything filed inside goes too, however deeply nested.',
      'A node that is also filed somewhere else is kept, in that place.',
    ],
  },
]

/**
 * The containment question, worded for one node or many.
 *
 * A function rather than a constant because "inside this one" and "inside these" is the
 * difference between a sentence about the card the user clicked and one about a selection
 * they rubber-banded, and the dialog is the same component for both.
 */
export function insideSectionDescription(count: number): string {
  return count === 1
    ? 'What happens to the nodes filed inside this one.'
    : 'What happens to the nodes filed inside these.'
}

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
    /*
     * "Kept" rather than "moved up", because this counts every node inside the selection
     * at any depth and only the top row of them changes hands: the rest move with their
     * own parent and stay nested inside it. What is true of all of them is that they
     * survive, which is also the number the other option would turn into deletions.
     *
     * Neutral, where this used to be amber. Amber was reporting the old wording rather
     * than the outcome -- nothing here is lost -- so it argued against the safe default.
     */
    stats.push({
      value: impact.orphanCount,
      label: impact.orphanCount === 1 ? 'node kept' : 'nodes kept',
      tone: 'neutral',
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
        'node filed inside them',
        'nodes filed inside them',
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
