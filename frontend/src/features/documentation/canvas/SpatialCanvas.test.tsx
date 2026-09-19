import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SpatialCanvas, reconcileCanvasNodes } from '@/features/documentation/canvas/SpatialCanvas'
import type { DocumentationNode } from '@/types'

function node(id: string, x: number, y: number): DocumentationNode {
  return {
    id,
    title: `Node ${id}`,
    summary: null,
    position: { x, y, z: 0 },
    size: { width: 240, height: 120, depth: 0 },
    metadata: {},
  }
}

const NODES = [node('c', 0, 400), node('b', 300, 0), node('a', 0, 12)]

describe('canvas reconciliation', () => {
  const actions = {
    onDive: vi.fn(), onInspect: vi.fn(), onDelete: vi.fn(), onStartLink: vi.fn(),
    onRename: vi.fn(), onGoUp: vi.fn(), onDuplicate: vi.fn(),
  }

  function cards() {
    return NODES.map((record) => ({
      id: record.id,
      type: 'documentation' as const,
      position: { x: record.position.x, y: record.position.y },
      data: {
        node: record, readers: [], actions, blockCount: null, linking: false,
        editable: true, dropTarget: false, disconnected: false, cursor: false,
      },
      selected: false,
    }))
  }

  it('reuses the array and card data when nothing visible changed', () => {
    const current = cards()
    expect(reconcileCanvasNodes(current, cards(), false)).toBe(current)
  })

  it('changes only the selected card and preserves the other objects', () => {
    const current = cards()
    const incoming = cards()
    incoming[1]!.selected = true
    const next = reconcileCanvasNodes(current, incoming, false)
    expect(next[0]).toBe(current[0])
    expect(next[1]).not.toBe(current[1])
    expect(next[1]?.selected).toBe(true)
    expect(next[2]).toBe(current[2])
  })

  it('preserves local drag positions measurements and area selection', () => {
    const current = cards().map((card) => ({
      ...card,
      position: { x: 50, y: 80 },
      measured: { width: 240, height: 120 },
      dragging: true,
      selected: true,
    }))
    expect(reconcileCanvasNodes(current, cards(), true)).toBe(current)
  })
})

function setup(overrides: Partial<React.ComponentProps<typeof SpatialCanvas>> = {}) {
  const props = {
    nodes: NODES,
    relationships: [],
    selectedNodeId: null,
    focusKey: 'root',
    onSelectNode: vi.fn(),
    onMoveNode: vi.fn(),
    onConnectNodes: vi.fn(),
    onDive: vi.fn(),
    onAscend: vi.fn(),
    onDeleteNode: vi.fn(),
    onCreateNode: vi.fn(),
    ...overrides,
  }

  const view = render(<SpatialCanvas {...props} />)

  return {
    props,
    canvas: screen.getByTestId('spatial-canvas'),
    /** Re-renders with a changed prop, for the tests that move between levels. */
    update: (next: Partial<React.ComponentProps<typeof SpatialCanvas>>) =>
      view.rerender(<SpatialCanvas {...props} {...next} />),
  }
}

/**
 * Where the keyboard cursor is, read the way a screen reader reads it.
 *
 * The cursor is a ring on a card, which is nothing to assert on -- and in jsdom the cards
 * are not measured, so React Flow may not have drawn any. The live region says the same
 * thing in words and is rendered from the same state.
 */
function cursor(): string {
  return screen.getByTestId('spatial-canvas').querySelector('[aria-live="polite"]')?.textContent ?? ''
}

describe('SpatialCanvas keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('walks the level in reading order rather than the order nodes arrived', async () => {
    const { canvas } = setup()
    canvas.focus()

    // Top row first, left to right: a, then b. Not c, which is 400px below both.
    await userEvent.keyboard('{ArrowRight}')
    expect(cursor()).toBe('Node a, 1 of 3')

    await userEvent.keyboard('{ArrowRight}')
    expect(cursor()).toBe('Node b, 2 of 3')
  })

  it('moves the cursor without selecting, so walking a level opens no panels', async () => {
    const { props, canvas } = setup()
    canvas.focus()

    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')

    // The whole reason the cursor exists: selecting each card in turn would fetch and
    // open its page, and cover the canvas being walked with the panel it opens in.
    expect(props.onSelectNode).not.toHaveBeenCalled()
  })

  it('wraps round, so the level is a loop and not a line with two dead ends', async () => {
    const { canvas } = setup({ selectedNodeId: 'c' })
    canvas.focus()

    // The cursor starts from the selection, which is how a session that began with the
    // mouse carries on with the keyboard. c is last, so forward comes back to the first.
    await userEvent.keyboard('{ArrowRight}')
    expect(cursor()).toBe('Node a, 1 of 3')

    // And backward from the first wraps to the last. It continues from `a` -- where the
    // last press left the cursor -- rather than from the `selectedNodeId` prop, which
    // still says c and has not been touched by any of this.
    await userEvent.keyboard('{ArrowLeft}')
    expect(cursor()).toBe('Node c, 3 of 3')
  })

  it('treats Down as forward and Up as back, because the cycle has one dimension', async () => {
    const { canvas } = setup({ selectedNodeId: 'a' })
    canvas.focus()

    await userEvent.keyboard('{ArrowDown}')
    expect(cursor()).toBe('Node b, 2 of 3')

    await userEvent.keyboard('{ArrowUp}')
    expect(cursor()).toBe('Node a, 1 of 3')
  })

  it('goes inside the card under the cursor on Enter', async () => {
    const { props, canvas } = setup()
    canvas.focus()

    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}')

    expect(props.onDive).toHaveBeenCalledWith('b')
  })

  it('puts the cursor on the first card of the level it dives into', async () => {
    const { canvas, update } = setup()
    canvas.focus()

    await userEvent.keyboard('{ArrowRight}{Enter}')

    // The level arrives as new props: different cards, a different focus key. Landing the
    // cursor on the first of them is what lets a keyboard run continue past a dive.
    const inside = [node('x', 0, 0), node('y', 300, 0)]
    update({ nodes: inside, focusKey: 'a' })

    expect(cursor()).toBe('Node x, 1 of 2')
  })

  it('leaves the level on Escape, landing the cursor on the node just left', async () => {
    const { props, canvas, update } = setup({ focusNodeId: 'b', focusKey: 'b' })
    canvas.focus()

    await userEvent.keyboard('{Escape}')

    expect(props.onAscend).toHaveBeenCalledWith()
    // Escape must not also open or move anything.
    expect(props.onDive).not.toHaveBeenCalled()
    // Every card here is about to be unmounted, so the focus is parked on the canvas
    // rather than being dropped onto the body, where the next key would reach nothing.
    expect(document.activeElement).toBe(canvas)

    // Coming up puts the cursor on the node that was being looked inside, the way a file
    // manager leaves the folder you came out of selected.
    update({ focusNodeId: null, focusKey: 'root' })
    expect(cursor()).toBe('Node b, 2 of 3')
  })

  it('adds a node on n, and leaves Cmd+N to the browser', async () => {
    const { props, canvas } = setup()
    canvas.focus()

    await userEvent.keyboard('n')
    expect(props.onCreateNode).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Meta>}n{/Meta}')
    expect(props.onCreateNode).toHaveBeenCalledTimes(1)
  })

  it('nudges the card under the cursor with Shift held', async () => {
    const { props, canvas } = setup({ selectedNodeId: 'a' })
    canvas.focus()

    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')

    expect(props.onMoveNode).toHaveBeenCalledWith('a', { x: 16, y: 12, z: 0 })
    // Shift moves the card, not the cursor: the two are the same keys and this is the
    // only thing that distinguishes them.
    expect(cursor()).toBe('Node a, 1 of 3')
  })

  it('leaves the keys alone for a reader who may not change anything', async () => {
    const { props, canvas } = setup({ selectedNodeId: 'a', editable: false })
    canvas.focus()

    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(props.onMoveNode).not.toHaveBeenCalled()

    await userEvent.keyboard('n')
    expect(props.onCreateNode).not.toHaveBeenCalled()

    // Navigation is reading, so it stays.
    await userEvent.keyboard('{ArrowRight}')
    expect(cursor()).toBe('Node b, 2 of 3')
  })
})
