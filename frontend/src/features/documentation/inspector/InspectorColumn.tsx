import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The column the inspector lives in, and the one thing about it the user controls.
 *
 * The panel was a fixed 24rem, which is a sidebar width -- fine for a property sheet and
 * much too narrow for a page of documentation: a table wrapped, a code block scrolled
 * sideways, and prose came out at forty characters a line. It opens on half of what is
 * beside the navigation rail now, because the two things on this screen are a map and a
 * page about one thing on it, and neither is the lesser of the two.
 *
 * Half is the starting point rather than the rule: the divider drags, because how much
 * of the screen the writing deserves depends on whether you are reading the graph or
 * writing about it, and only the person doing it knows which.
 *
 * What is remembered is the *share* of the row rather than a number of pixels. A width
 * that is right on a laptop is a third of a 32-inch monitor and most of a small window,
 * so storing pixels means the split the user chose survives only until they change
 * screens -- and moving the window would quietly turn a half into something else.
 *
 * It is remembered locally rather than on the server for the same reason: it is a
 * property of this screen, not of the document.
 */

const STORAGE_KEY = 'sourcebox:inspector-share'
/** Equal halves of the space beside the nav rail. */
const DEFAULT_SHARE = 0.5
/** Below this the panel is a property sheet again, whatever the share works out to. */
const MIN_WIDTH = 380
/** The canvas has to stay usable, however wide the panel is dragged. */
const MIN_CANVAS = 320
const KEYBOARD_STEP = 32

function storedShare(): number {
  if (typeof window === 'undefined') return DEFAULT_SHARE

  const saved = Number(window.localStorage.getItem(STORAGE_KEY))

  return Number.isFinite(saved) && saved > 0 && saved < 1 ? saved : DEFAULT_SHARE
}

/** The share as pixels, kept between "still a page" and "the canvas is still a canvas". */
function widthFor(share: number, available: number): number {
  const ceiling = Math.max(available - MIN_CANVAS, MIN_WIDTH)

  return Math.round(Math.min(Math.max(share * available, MIN_WIDTH), ceiling))
}

/**
 * What the panel will open at, for a caller that needs the number before it is mounted.
 *
 * The canvas offsets what it centres by the panel's width, and the first selection
 * happens before this column has measured anything -- so the estimate here is the row
 * width as it is with the rail collapsed. The column reports the measured width as soon
 * as it has one.
 */
export function initialInspectorWidth(): number {
  if (typeof window === 'undefined') return MIN_WIDTH

  const RAIL = 48

  return widthFor(storedShare(), window.innerWidth - RAIL)
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
  const asideRef = useRef<HTMLElement>(null)
  const [share, setShare] = useState(storedShare)
  const [dragging, setDragging] = useState(false)

  /*
    The row the panel and the canvas divide between them.

    Measured rather than taken from `window.innerWidth`, because the navigation rail is
    part of the window and not part of what these two share -- and it changes width when
    it is opened. The aside is inside the row, so resizing the panel does not move this
    number; only the window and the rail do.
  */
  const [available, setAvailable] = useState(() =>
    typeof window === 'undefined' ? MIN_WIDTH + MIN_CANVAS : window.innerWidth,
  )

  useLayoutEffect(() => {
    const row = asideRef.current?.parentElement
    if (!row) return

    const measure = () => setAvailable(row.clientWidth)

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(row)

    return () => observer.disconnect()
  }, [])

  const width = widthFor(share, available)

  // The canvas centres on a node by allowing for the panel covering part of the row, so
  // it hears about a width that changed because the window did, not only about drags.
  useEffect(() => {
    onWidthChange?.(width)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width])

  const save = useRef<number | null>(null)

  const resize = useCallback(
    (nextWidth: number) => {
      const next = widthFor(nextWidth / available, available) / available

      setShare(next)

      // Written on a trailing timer rather than per pointer move: a drag is a hundred
      // events and localStorage is synchronous.
      if (save.current !== null) window.clearTimeout(save.current)
      save.current = window.setTimeout(() => {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      }, 200)
    },
    [available],
  )

  // A drag that starts on the handle has to keep working over the canvas, which swallows
  // pointer events of its own, so the listeners live on the window for its duration.
  useEffect(() => {
    if (!dragging) return

    const row = asideRef.current?.parentElement

    const onMove = (event: PointerEvent) => {
      const right = row ? row.getBoundingClientRect().right : window.innerWidth

      resize(right - event.clientX)
    }
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

  return (
    <aside
      ref={asideRef}
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
        aria-valuemax={Math.max(available - MIN_CANVAS, MIN_WIDTH)}
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
