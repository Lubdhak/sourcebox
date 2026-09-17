import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * The way back through the inspector, one hop at a time.
 *
 * A node's page links to other nodes -- a mention in the prose, a relationship in the
 * graph -- and following one replaces what the panel is showing. This holds the pages
 * left behind, newest last, so "back" means the page before this one and pressing it
 * repeatedly walks the way in reverse. A browser's back button, for a panel that has no
 * URL of its own.
 *
 * It is a stack rather than a single remembered origin, which is what this replaced.
 * Jumping straight to the start of the chain is the wrong answer for the reason people
 * follow mentions at all: reading around a subject and then stepping back through what
 * was read. Throwing away the middle of that is throwing away the reading.
 *
 * Titles are cached here as well as stacked. A page in the trail may be on a level the
 * canvas has since moved off, so the graph on screen cannot always name it -- but every
 * page in the trail was open in the panel, and that is when its title passes through.
 */

export interface TrailPage {
  id: string
  title: string
}

export interface InspectorTrail {
  /** The page one hop back, or null when there is nowhere to go. */
  back: TrailPage | null
  /** Records a link followed away from `from`. */
  follow: (from: TrailPage | null, to: string) => void
  /** Steps back one hop, returning the page to show. */
  pop: () => TrailPage | null
  /** Starts again: a canvas selection is a new beginning, not a step in a path. */
  reset: () => void
  /** Notes a node's title, for naming it in the trail later. */
  remember: (nodeId: string, title: string) => void
}

export function useInspectorTrail(): InspectorTrail {
  const [pages, setPages] = useState<TrailPage[]>([])
  const titles = useRef(new Map<string, string>())

  const remember = useCallback((nodeId: string, title: string) => {
    titles.current.set(nodeId, title)
  }, [])

  const follow = useCallback((from: TrailPage | null, to: string) => {
    // A link to the page you are already on is not a hop, and pushing it would mean a
    // back button that appears to do nothing.
    if (!from || from.id === to) return

    setPages((current) => [...current, { id: from.id, title: titles.current.get(from.id) ?? from.title }])
  }, [])

  const pop = useCallback(() => {
    const previous = pages.at(-1) ?? null
    if (previous) setPages((current) => current.slice(0, -1))

    return previous
  }, [pages])

  const reset = useCallback(() => setPages([]), [])

  // Memoised, because the page wires these into callbacks that the canvas and the header
  // depend on: a fresh object per render would rebuild all of them on every keystroke
  // anywhere in the space.
  return useMemo(
    () => ({ back: pages.at(-1) ?? null, follow, pop, reset, remember }),
    [follow, pages, pop, remember, reset],
  )
}
