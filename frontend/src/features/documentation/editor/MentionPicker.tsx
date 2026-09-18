import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The nodes an `@` could become, and the keys that choose one.
 *
 * The list hangs off the `@` being typed, which Plate keeps as an element in the document
 * -- so it survives re-renders and the caret stays where the words are. What cannot live
 * in the document is which row is highlighted, so the open picker registers itself here
 * and the editor's key handler talks to that. One picker can be open at a time, which is
 * what makes a module-level handle honest rather than lazy: there is exactly one `@` being
 * typed at any moment.
 */

export interface MentionCandidate {
  id: string
  title: string
}

const MENTION_DEBOUNCE_MS = 150
const MENTION_LIMIT = 8

interface OpenPicker {
  matches: MentionCandidate[]
  highlighted: number
  highlight: (index: number) => void
  pick: (candidate: MentionCandidate) => void
}

let open: OpenPicker | null = null

/**
 * Arrow keys and Enter, while a picker is open.
 *
 * Returns whether the key was consumed, so the caller can keep it from reaching the
 * document -- ArrowDown in a list of names must not move the caret instead.
 */
export function mentionKeys(key: string): boolean {
  if (!open || open.matches.length === 0) return false

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const step = key === 'ArrowDown' ? 1 : -1
    open.highlight((open.highlighted + step + open.matches.length) % open.matches.length)

    return true
  }

  if (key === 'Enter' || key === 'Tab') {
    const candidate = open.matches[open.highlighted] ?? open.matches[0]
    if (candidate) open.pick(candidate)

    return true
  }

  return false
}

export function MentionPicker({
  query,
  matches,
  onPick,
}: {
  query: string
  matches: MentionCandidate[]
  onPick: (candidate: MentionCandidate) => void
}) {
  const [highlighted, setHighlighted] = useState(0)

  // Back to the top whenever the query changes, or the highlight would point into a list
  // that no longer has that many rows.
  useEffect(() => setHighlighted(0), [query])

  // Registered on every render rather than on mount, so the handle is never a stale copy
  // of the list or of the callback that inserts the chip.
  const pick = useRef(onPick)
  pick.current = onPick

  useEffect(() => {
    const handle: OpenPicker = {
      matches,
      highlighted,
      highlight: setHighlighted,
      pick: (candidate) => pick.current(candidate),
    }

    open = handle

    return () => {
      if (open === handle) open = null
    }
  })

  return (
    <span
      role="listbox"
      aria-label="Nodes to mention"
      contentEditable={false}
      className="absolute left-0 top-full z-20 mt-1 block max-h-64 w-72 overflow-y-auto rounded-sm border border-border bg-popover p-1 shadow-lg"
    >
      {matches.length === 0 ? (
        <span className="block px-2 py-1.5 text-xs text-muted-foreground">
          {query ? `No node matches “${query}”.` : 'Type to find a node.'}
        </span>
      ) : (
        matches.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlighted(index)}
            onClick={() => onPick(candidate)}
            className={cn(
              'flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left',
              index === highlighted && 'bg-accent',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-sm">{candidate.title}</span>
          </button>
        ))
      )}
    </span>
  )
}

/**
 * The nodes offered for the mention being typed.
 *
 * Two sources, on purpose. Before anything is typed the answer is what is on screen --
 * the level the author is looking at, which is where most links point -- and once they
 * type it becomes a search across the whole space, because the node you want to reference
 * is frequently not the one you can see.
 */
export function useMentionCandidates({
  query,
  candidates,
  onSearch,
}: {
  query: string
  candidates: MentionCandidate[]
  onSearch: (query: string) => Promise<MentionCandidate[]>
}): MentionCandidate[] {
  const [found, setFound] = useState<MentionCandidate[] | null>(null)
  const search = useRef(onSearch)
  search.current = onSearch

  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length < 2) {
      setFound(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      search
        .current(trimmed)
        // A failed lookup falls back to the local list rather than showing an error
        // inside a picker: the author is mid-sentence.
        .then((results) => !cancelled && setFound(results))
        .catch(() => !cancelled && setFound(null))
    }, MENTION_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed])

  return useMemo(() => {
    const local = candidates.filter((candidate) =>
      candidate.title.toLowerCase().includes(trimmed.toLowerCase()),
    )

    // Local matches first: they are the nodes in view, and they arrive without a round
    // trip, so the list never appears to change under a fast typist's fingers.
    const merged = [...local]
    for (const candidate of found ?? []) {
      if (!merged.some((existing) => existing.id === candidate.id)) merged.push(candidate)
    }

    return merged.slice(0, MENTION_LIMIT)
  }, [candidates, found, trimmed])
}
