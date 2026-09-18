import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The column the inspector lives in, and the one thing about it the user controls.
 *
 * The panel was a fixed 24rem, which is a sidebar width -- fine for a property sheet and
 * much too narrow for a page of documentation: a table wrapped, a code block scrolled
 * sideways, and prose came out at forty characters a line. It defaults to nearly twice
 * that now and can be dragged, because how much of the screen the writing deserves
 * depends on whether you are reading the graph or writing about it, and only the person
 * doing it knows which.
 *
 * The width is remembered locally rather than on the server. It is a property of this
 * screen, not of the document -- the same account on a laptop and a 32-inch monitor wants
 * two different answers, and syncing it would make one of them wrong.
 */

const STORAGE_KEY = 'sourcebox:inspector-width'
const DEFAULT_WIDTH = 560
const MIN_WIDTH = 380
const MAX_WIDTH = 960
/** The canvas has to stay usable, however wide the panel is dragged. */
const MIN_CANVAS = 320
const KEYBOARD_STEP = 32

function clamp(width: number): number {
  const ceiling =
    typeof window === 'undefined' ? MAX_WIDTH : Math.min(MAX_WIDTH, window.innerWidth - MIN_CANVAS)

  return Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(ceiling, MIN_WIDTH)))
}

function storedWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH

  const saved = Number(window.localStorage.getItem(STORAGE_KEY))

  return clamp(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WIDTH)
}

export function InspectorColumn({
  open,
  children,
  onWidthChange,
}: {
  open: boolean
  children: React.ReactNode
  /** Called whenever the panel is resized, so the parent can pass the width to the canvas. */
  onWidthChange?: (width: number) => void
}) {
  const [width, setWidth] = useState(storedWidth)
  const [dragging, setDragging] = useState(false)

  const save = useRef<number | null>(null)

  const resize = useCallback((next: number) => {
    const clamped = clamp(next)
    setWidth(clamped)
    onWidthChange?.(clamped)

    // Written on a trailing timer rather than per pointer move: a drag is a hundred
    // events and localStorage is synchronous.
    if (save.current !== null) window.clearTimeout(save.current)
    save.current = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, String(clamped))
    }, 200)
  }, [])

  // A drag that starts on the handle has to keep working over the canvas, which swallows
  // pointer events of its own, so the listeners live on the window for its duration.
  useEffect(() => {
    if (!dragging) return

    const onMove = (event: PointerEvent) => resize(window.innerWidth - event.clientX)
    const onUp = () => setDragging(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    // Without this the drag selects text across the page it is resizing.
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.userSelect = previous
    }
  }, [dragging, resize])

  // A window narrow enough to squeeze the canvas rewrites the width rather than letting
  // the panel win.
  useEffect(() => {
    const onResize = () => setWidth((current) => clamp(current))

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <aside
      className="relative shrink-0 overflow-hidden border-l border-border bg-background"
      style={{
        width: open ? width : 0,
        transition: 'width 350ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      }}
      aria-label="Node inspector"
      aria-hidden={!open}
    >
      {/*
        The inner div is pinned to the full stored width so the content never reflows
        or wraps during the transition. The outer aside clips it as it slides in/out.
      */}
      <div className="relative h-full" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') resize(width + KEYBOARD_STEP)
          else if (event.key === 'ArrowRight') resize(width - KEYBOARD_STEP)
          else return

          event.preventDefault()
        }}
        className={cn(
          'absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-ring',
          dragging && 'after:bg-ring',
        )}
      />

      <div className="h-full overflow-hidden">{children}</div>
      </div>
    </aside>
  )
}
