import { Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import * as api from '@/features/documentation/graphql'
import { logger } from '@/lib/logger'
import type { SearchResult } from '@/types'

/**
 * Search across one space's nodes and their content.
 *
 * Search is the second navigation model, and in a graph it is arguably the first: spatial
 * browsing answers "what is near this", and only search answers "where is the thing I am
 * thinking of" in a space too large to scan. Selecting a result selects the node, which
 * moves the canvas and opens the inspector -- the user is never taken to a separate
 * results page, because leaving the map to find something on the map is exactly the
 * disorientation a spatial interface is supposed to avoid.
 *
 * Ranking, stemming and phrase handling are PostgreSQL's; this component debounces,
 * cancels and renders.
 */

const DEBOUNCE_MS = 200
const MIN_QUERY_LENGTH = 2

export function SearchPanel({
  spaceId,
  onSelectNode,
}: {
  spaceId: string
  onSelectNode: (nodeId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const inFlight = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(
    (value: string) => {
      inFlight.current?.abort()

      if (value.trim().length < MIN_QUERY_LENGTH) {
        setResults(null)
        setSearching(false)
        return
      }

      const controller = new AbortController()
      inFlight.current = controller
      setSearching(true)

      api
        .searchDocumentation({ spaceId, query: value }, { signal: controller.signal })
        .then((found) => setResults(found))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return

          // A failed search is not worth an error banner over the canvas: the user can
          // see that nothing came back and can try again by typing.
          setResults([])
          logger.warn('frontend.documentation_search_failed', {
            errorMessage: err instanceof Error ? err.message : String(err),
          })
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    },
    [spaceId],
  )

  // Debounced, and every superseded request is aborted. Without the abort, a slow
  // response for "pay" can land after a fast one for "payments" and replace correct
  // results with stale ones.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => run(query), DEBOUNCE_MS)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, run])

  useEffect(() => () => inFlight.current?.abort(), [])

  // `/` focuses search, the convention every search-first interface shares. Ignored while
  // the user is typing somewhere else, which would otherwise make it impossible to write
  // a slash into a block.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return

      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return
      }

      event.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
              inputRef.current?.blur()
            }
          }}
          placeholder="Search this space  /"
          aria-label="Search this space"
          className="h-8 w-64 pl-7"
        />
        {searching ? (
          <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {results !== null ? (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute z-20 mt-1 max-h-80 w-96 overflow-y-auto rounded-sm border border-border bg-popover p-1 shadow-md"
        >
          {results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((result) => (
              <button
                key={result.node.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onSelectNode(result.node.id)
                  setQuery('')
                  setResults(null)
                }}
                className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm">{result.node.title}</span>
                </span>
                {result.snippet ? (
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {result.snippet}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
