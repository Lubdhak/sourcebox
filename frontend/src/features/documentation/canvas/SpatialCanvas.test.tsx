import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SpatialCanvas } from '@/features/documentation/canvas/SpatialCanvas'
import type { DocumentationNode, Layer } from '@/types'

/*
 * The canvas from the keyboard.
 *
 * Asserted through the wrapper's key events rather than through React Flow's internals,
 * because what is being protected is the binding table -- arrows walk the level, Enter
 * goes in, Escape comes out -- and that has to survive a React Flow upgrade changing how
 * it renders nodes.
 */

// Laid out as two rows: A and B alongside each other, C below them. Reading order is
// therefore A, B, C whatever order they arrive in.
function node(id: string, x: number, y: number): DocumentationNode {
  return {
    id,
    nodeType: 'service',
    title: `Node ${id}`,
    summary: null,
    position: { x, y, z: 0 },
    size: { width: 240, height: 120, depth: 0 },
    metadata: {},
    layerId: 'l1',
  }
}

const NODES = [node('c', 0, 400), node('b', 300, 0), node('a', 0, 12)]
const LAYERS: Layer[] = [{ id: 'l1', index: 0, name: 'Overview', description: null, nodeCount: 3 }]

function setup(overrides: Partial<React.ComponentProps<typeof SpatialCanvas>> = {}) {
  const props = {
    nodes: NODES,
    relationships: [],
    layers: LAYERS,
    selectedNodeId: null,
    focusKey: 'root',
    onSelectNode: vi.fn(),
    onMoveNode: vi.fn(),
    onConnectNodes: vi.fn(),
    onDive: vi.fn(),
    onAscend: vi.fn(),
    onDeleteNode: vi.fn(),
    ...overrides,
  }

  render(<SpatialCanvas {...props} />)

  return { props, canvas: screen.getByTestId('spatial-canvas') }
}

describe('SpatialCanvas keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('walks the level in reading order rather than the order nodes arrived', async () => {
    const { props, canvas } = setup()
    canvas.focus()

    // Top row first, left to right: a, then b. Not c, which is 400px below both.
    await userEvent.keyboard('{ArrowRight}')
    expect(props.onSelectNode).toHaveBeenLastCalledWith('a')
  })

  it('wraps round, so the level is a loop and not a line with two dead ends', async () => {
    const { props, canvas } = setup({ selectedNodeId: 'c' })
    canvas.focus()

    // c is last in reading order, so forward comes back to the first card.
    await userEvent.keyboard('{ArrowRight}')
    expect(props.onSelectNode).toHaveBeenLastCalledWith('a')

    // And backward from the first wraps to the last. This continues from `a` rather than
    // from the stale `selectedNodeId` prop because the previous step moved the keyboard
    // focus onto that card -- which is what lets a run of arrow presses work without the
    // page re-rendering between each one.
    await userEvent.keyboard('{ArrowLeft}')
    expect(props.onSelectNode).toHaveBeenLastCalledWith('c')
  })

  it('opens the selected node on Enter, asking for something to be selected on arrival', async () => {
    const { props, canvas } = setup({ selectedNodeId: 'b' })
    canvas.focus()

    await userEvent.keyboard('{Enter}')

    // The flag is what keeps a keyboard run going: the level being arrived at has to
    // select something, or the next keystroke has nothing to act on.
    expect(props.onDive).toHaveBeenCalledWith('b', { fromKeyboard: true })
  })

  it('leaves the level on Escape, and keeps the keyboard inside the canvas', async () => {
    const { props, canvas } = setup({ selectedNodeId: 'b' })
    canvas.focus()

    await userEvent.keyboard('{Escape}')

    expect(props.onAscend).toHaveBeenCalledWith({ fromKeyboard: true })
    // Escape must not also open or move anything.
    expect(props.onDive).not.toHaveBeenCalled()
    // Every card here is about to be unmounted, so the focus is parked on the canvas
    // rather than being dropped onto the body, where the next key would reach nothing.
    expect(document.activeElement).toBe(canvas)
  })

  it('nudges the card with Shift held, which is what arrows alone used to do', async () => {
    const { props, canvas } = setup({ selectedNodeId: 'a' })
    canvas.focus()

    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')

    expect(props.onMoveNode).toHaveBeenCalledWith('a', { x: 16, y: 12, z: 0 })
    expect(props.onSelectNode).not.toHaveBeenCalled()
  })

  it('leaves the keys alone for a reader who may not move anything', async () => {
    const { props, canvas } = setup({ selectedNodeId: 'a', editable: false })
    canvas.focus()

    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(props.onMoveNode).not.toHaveBeenCalled()

    // Navigation is reading, so it stays.
    await userEvent.keyboard('{ArrowRight}')
    expect(props.onSelectNode).toHaveBeenLastCalledWith('b')
  })
})
