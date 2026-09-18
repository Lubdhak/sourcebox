import { Unlink } from 'lucide-react'

/**
 * A node the graph does not reach: nothing contains it, it contains nothing, and no
 * relationship of any kind touches it.
 *
 * Worth marking because it is otherwise invisible. A node inside something is found by
 * opening that thing, and a node with edges is found by following one; a node with
 * neither can only be found by searching for a title you already know. Spaces accumulate
 * them quietly -- a draft started and abandoned, a card whose parent was deleted -- and
 * the only way to notice is for the node to say so.
 *
 * Both views say it the same way, which is why the predicate, the sentence and the icon
 * live here rather than being spelled out twice.
 */

/**
 * Whether a node is connected to nothing, according to the server's count.
 *
 * Absent means unknown rather than zero, and that distinction is the reason this is a
 * function. Nodes patched into the canvas from a collaborator's realtime message carry
 * only the fields that changed, and treating a missing count as "connected to nothing"
 * would grey out other people's cards as they edited them.
 */
export function isDisconnected(relationshipCount: number | null | undefined): boolean {
  return relationshipCount === 0
}

/** Said in full where there is room, and as a tooltip where there is not. */
export const DISCONNECTED_HINT = 'Not connected to anything: nothing contains this node and nothing links to it.'

/** The short form, for the page header where the icon has a label beside it. */
export const DISCONNECTED_LABEL = 'Not connected'

/** One icon in one place, so the card and the page cannot end up with different ones. */
export const DisconnectedIcon = Unlink
