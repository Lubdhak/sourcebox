import type { DocumentationNode } from '@/types'

/**
 * The order a level is read in: rows down the screen, left to right within a row.
 *
 * Shared between the canvas, which walks it with the arrow keys, and the graph state,
 * which uses it to put the selection somewhere sensible after moving between levels. One
 * definition, because two would disagree the moment either changed and the keyboard would
 * start somewhere other than where the arrows continue from.
 *
 * Not the order the server returned, which is by id and therefore by the accident of when
 * each node was written. On a spatial canvas the only order a person can predict is the
 * one they can see.
 */
export function readingOrder(nodes: DocumentationNode[]): DocumentationNode[] {
  // Rows are banded rather than exact: cards on the same visual row are rarely aligned to
  // the pixel, and sorting by raw `y` would zig-zag between them. The band is a little
  // under a card's height, so a card has to be genuinely lower to count as a new row.
  const band = (value: number) => Math.round(value / 120)

  return [...nodes].sort(
    (a, b) =>
      band(a.position.y) - band(b.position.y) ||
      a.position.x - b.position.x ||
      a.position.y - b.position.y,
  )
}
