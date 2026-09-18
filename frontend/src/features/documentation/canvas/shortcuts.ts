import type { Shortcut } from '@/components/AppSidebar'

/**
 * The canvas keyboard, as the navigation rail prints it for the user.
 *
 * Kept beside `SpatialCanvas.handleKeyDown`, which is the thing it describes, so the two
 * are changed in one place: a list of shortcuts that has drifted from the bindings is
 * worse than no list, because the user stops trusting the ones that do work.
 *
 * Reading keys first, then writing keys, and only when there is something to write with
 * them -- a viewer told about F2 would press it and conclude the keyboard is broken.
 */
export function canvasShortcuts(editable: boolean): Shortcut[] {
  const reading: Shortcut[] = [
    { keys: ['←', '→'], label: 'Move between cards' },
    { keys: ['Space'], label: 'Open the panel' },
    { keys: ['↵'], label: 'Go inside' },
    { keys: ['Esc'], label: 'Back out' },
    { keys: ['/'], label: 'Search' },
    { keys: ['⌘B'], label: 'This sidebar' },
  ]

  if (!editable) return reading

  return [
    ...reading,
    { keys: ['⇧', '↑↓←→'], label: 'Nudge the card' },
    { keys: ['N'], label: 'New node' },
    { keys: ['R'], label: 'Rename' },
  ]
}
