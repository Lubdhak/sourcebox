import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphState } from '@/features/documentation/useGraphState'
import type { DocumentationNode, SpaceGraph } from '@/types'

vi.mock('@/features/documentation/graphql', () => ({
  fetchSpaceGraph: vi.fn(),
  moveNodes: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  reparentNode: vi.fn(),
  cloneNode: vi.fn(),
  createRelationship: vi.fn(),
  deleteRelationship: vi.fn(),
}))

const api = await import('@/features/documentation/graphql')

const SPACE_ID = 'space-uuid'

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

function graph(): SpaceGraph {
  return {
    nodes: [node('1', 0, 0), node('2', 100, 0)],
    relationships: [
      { id: 'r1', relationshipType: 'calls', sourceNodeId: '1', targetNodeId: '2', metadata: {} },
    ],
    nodeCount: 2,
    relationshipCount: 1,
    truncated: false,
  }
}

function setup(initialGraph = graph()) {
  return renderHook(() =>
    useGraphState({ spaceId: SPACE_ID, initialGraph }),
  )
}

describe('useGraphState', () => {
  beforeEach(() => {
    vi.mocked(api.fetchSpaceGraph).mockResolvedValue({
      id: SPACE_ID,
      name: 'Platform',
      slug: 'platform',
      description: null,
      settings: {},
      graph: graph(),
    })
    vi.mocked(api.moveNodes).mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('renders the Inertia snapshot before any request completes', async () => {
    const { result } = setup()

    // The reason the page has content on first paint rather than a spinner.
    expect(result.current.nodes).toHaveLength(2)
    expect(result.current.relationships).toHaveLength(1)

    expect(api.fetchSpaceGraph).not.toHaveBeenCalled()
  })

  it('uses the complete focused snapshot without a mount refetch', () => {
    const initialGraph = {
      ...graph(),
      focusNode: node('folder', 0, 0),
      trail: [node('root', 0, 0)],
      neighbors: [node('elsewhere', 0, 0)],
    }
    const { result } = setup(initialGraph)

    expect(result.current.focusNodeId).toBe('folder')
    expect(result.current.focusNode).toBe(initialGraph.focusNode)
    expect(result.current.trail).toBe(initialGraph.trail)
    expect(result.current.neighbors).toBe(initialGraph.neighbors)
    expect(api.fetchSpaceGraph).not.toHaveBeenCalled()
  })

  it('keeps local edits on rerender but adopts a new Inertia snapshot', () => {
    const initialGraph = graph()
    const { result, rerender } = renderHook(
      (props) => useGraphState(props),
      { initialProps: { spaceId: SPACE_ID, initialGraph, initialSelectedNodeId: '1' } },
    )
    act(() => result.current.selectNode('2'))
    rerender({ spaceId: SPACE_ID, initialGraph, initialSelectedNodeId: '1' })
    expect(result.current.selectedNodeId).toBe('2')

    const replacement = { ...graph(), nodes: [node('new', 10, 20)] }
    rerender({ spaceId: SPACE_ID, initialGraph: replacement, initialSelectedNodeId: 'new' })
    expect(result.current.nodes).toBe(replacement.nodes)
    expect(result.current.selectedNodeId).toBe('new')
    expect(api.fetchSpaceGraph).not.toHaveBeenCalled()
  })

  it('adopts a new space and ignores a late refresh of the previous space', async () => {
    const initialGraph = graph()
    const { result, rerender } = renderHook(
      (props) => useGraphState(props),
      { initialProps: { spaceId: SPACE_ID, initialGraph } },
    )
    let resolve!: (value: Awaited<ReturnType<typeof api.fetchSpaceGraph>>) => void
    vi.mocked(api.fetchSpaceGraph).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    let refresh!: Promise<void>
    act(() => { refresh = result.current.refresh() })

    const replacement = { ...graph(), nodes: [node('new-space-node', 0, 0)] }
    rerender({ spaceId: 'other-space', initialGraph: replacement })
    expect(result.current.nodes).toBe(replacement.nodes)
    await act(async () => {
      resolve({ id: SPACE_ID, name: 'Old', slug: 'old', description: null, settings: {}, graph: initialGraph })
      await refresh
    })
    expect(result.current.nodes).toBe(replacement.nodes)
    expect(result.current.error).toBeNull()
    expect(api.fetchSpaceGraph).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.refresh() })
    expect(api.fetchSpaceGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'other-space' }),
      expect.anything(),
    )
  })

  it('still coalesces structural realtime changes into a refresh after mount', async () => {
    vi.useFakeTimers()
    const { result } = setup()
    act(() => {
      result.current.applyRealtime({ type: 'documentation.node_created' })
      result.current.applyRealtime({ type: 'documentation.node_reparented' })
    })
    expect(api.fetchSpaceGraph).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(api.fetchSpaceGraph).toHaveBeenCalledTimes(1)
  })

  it('cancels a queued realtime refresh when Inertia replaces the snapshot', async () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      (initialGraph) => useGraphState({ spaceId: SPACE_ID, initialGraph }),
      { initialProps: graph() },
    )
    act(() => result.current.applyRealtime({ type: 'documentation.node_created' }))
    const replacement = graph()
    rerender(replacement)
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(api.fetchSpaceGraph).not.toHaveBeenCalled()
    expect(result.current.nodes).toBe(replacement.nodes)
  })

  it('applies a move immediately and sends it once, after the drag settles', async () => {
    vi.useFakeTimers()
    const { result } = setup()

    act(() => {
      result.current.moveNode('1', { x: 10, y: 10, z: 0 })
      result.current.moveNode('1', { x: 20, y: 20, z: 0 })
      result.current.moveNode('1', { x: 30, y: 30, z: 0 })
    })

    // Visible instantly; that is the point of optimistic.
    expect(result.current.nodes[0]?.position).toEqual({ x: 30, y: 30, z: 0 })
    expect(api.moveNodes).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // One request for the whole gesture, carrying only the final position. A drag emits
    // positions at pointer frequency; sending each would be dozens of transactions.
    expect(api.moveNodes).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.moveNodes).mock.calls[0]?.[0]).toEqual({
      spaceId: SPACE_ID,
      positions: [{ nodeId: '1', x: 30, y: 30, z: 0 }],
    })
  })

  it('coalesces several nodes moved together into one batch', async () => {
    vi.useFakeTimers()
    const { result } = setup()

    act(() => {
      result.current.moveNode('1', { x: 5, y: 5, z: 0 })
      result.current.moveNode('2', { x: 15, y: 15, z: 0 })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(vi.mocked(api.moveNodes).mock.calls[0]?.[0].positions).toHaveLength(2)
  })

  it('rolls back to the last server-confirmed positions when the move fails', async () => {
    vi.useFakeTimers()
    vi.mocked(api.moveNodes).mockRejectedValue(new Error('Network is down'))

    const { result } = setup()

    act(() => {
      result.current.moveNode('1', { x: 999, y: 999, z: 0 })
    })

    expect(result.current.nodes[0]?.position.x).toBe(999)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // Back to what the server last acknowledged, not to some intermediate local guess:
    // after a failure the only positions known to be real are the confirmed ones.
    expect(result.current.nodes[0]?.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.current.error).toBe('Network is down')
  })

  it('removes a relationship optimistically and restores it on failure', async () => {
    vi.mocked(api.deleteRelationship).mockRejectedValue(new Error('Nope'))
    const { result } = setup()

    await act(async () => {
      await result.current.removeRelationship('r1')
    })

    expect(result.current.relationships).toHaveLength(1)
    expect(result.current.error).toBe('Nope')
  })

  it('retitles a node immediately and keeps the server’s version', async () => {
    vi.mocked(api.updateNode).mockResolvedValue({ ...node('1', 0, 0), title: 'Checkout' })
    const { result } = setup()

    await act(async () => {
      await result.current.renameNode('1', 'Checkout')
    })

    expect(api.updateNode).toHaveBeenCalledWith({ nodeId: '1', title: 'Checkout' })
    expect(result.current.nodes.find((entry) => entry.id === '1')?.title).toBe('Checkout')
  })

  it('puts the old title back when the rename fails', async () => {
    vi.mocked(api.updateNode).mockRejectedValue(new Error('Nope'))
    const { result } = setup()

    await act(async () => {
      await result.current.renameNode('1', 'Checkout')
    })

    expect(result.current.nodes.find((entry) => entry.id === '1')?.title).toBe('Node 1')
    expect(result.current.error).toBe('Nope')
  })

  it('sends the level being left when a node is moved into another one', async () => {
    vi.mocked(api.reparentNode).mockResolvedValue(node('2', 100, 0))
    const { result } = setup()

    await act(async () => {
      await result.current.reparentNode('2', '1', 'old-parent')
    })

    // `fromParentId` is the point of the assertion: a node filed in several places must
    // lose only the containment the drag happened in.
    expect(api.reparentNode).toHaveBeenCalledWith({
      nodeId: '2',
      newParentId: '1',
      fromParentId: 'old-parent',
    })
  })

  it('reports a move the server refused instead of leaving the card where it was dropped', async () => {
    vi.mocked(api.reparentNode).mockRejectedValue(new Error('is inside'))
    const { result } = setup()

    await act(async () => {
      await result.current.reparentNode('1', '2', null)
    })

    expect(result.current.error).toBe('is inside')
  })

  it('selects a copy once it exists, because a copy is about to be edited', async () => {
    vi.mocked(api.cloneNode).mockResolvedValue(node('copy', 48, 48))
    const { result } = setup()

    await act(async () => {
      await result.current.cloneNode('1', true)
    })

    expect(api.cloneNode).toHaveBeenCalledWith('1', true)
    expect(result.current.selectedNodeId).toBe('copy')
  })

  /*
   * Deleting is no longer this hook's job. The policy, the impact preview and the
   * mutation all live in `useNodeDeletion`, so what is left here is the local aftermath:
   * drop the cards, clear a selection that pointed at one of them, and reconcile.
   */
  it('drops deleted cards immediately and clears a selection pointing at one', async () => {
    const { result } = setup()
    vi.mocked(api.fetchSpaceGraph).mockResolvedValueOnce({
      id: SPACE_ID, name: 'Platform', slug: 'platform', description: null, settings: {},
      graph: { ...graph(), nodes: [node('2', 100, 0)] },
    })

    act(() => result.current.selectNode('1'))
    expect(result.current.selectedNodeId).toBe('1')

    await act(async () => {
      await result.current.forgetNodes(['1'])
    })

    expect(result.current.nodes.some((node) => node.id === '1')).toBe(false)
    expect(result.current.selectedNodeId).toBeNull()
  })

  it('refetches after a deletion rather than reproducing the re-homing rules locally', async () => {
    const { result } = setup()

    const before = vi.mocked(api.fetchSpaceGraph).mock.calls.length

    await act(async () => {
      await result.current.forgetNodes(['2'])
    })

    expect(vi.mocked(api.fetchSpaceGraph).mock.calls.length).toBeGreaterThan(before)
  })

  it('lands with a card selected when the keyboard asked to go in', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.dive('1', { selectOnArrival: true })
    })

    // The first card in reading order: node 1 sits at 0,0 and node 2 at 100,0.
    expect(result.current.selectedNodeId).toBe('1')
  })

  it('leaves the selection alone when a mouse went in', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.dive('1')
    })

    // Otherwise a double-click into a node would also throw the inspector open over the
    // canvas the user has just navigated into.
    expect(result.current.selectedNodeId).toBeNull()
  })

  it('selects the node just left when the keyboard comes back up', async () => {
    vi.mocked(api.fetchSpaceGraph).mockResolvedValue({
      id: SPACE_ID,
      name: 'Platform',
      slug: 'platform',
      description: null,
      settings: {},
      graph: { ...graph(), focusNode: node('2', 100, 0), trail: [] },
    })

    const { result } = setup({ ...graph(), focusNode: node('2', 100, 0), trail: [] })

    await act(async () => {
      await result.current.ascend({ selectOnArrival: true })
    })

    // Coming out of node 2 puts the reader on node 2, not back at the start of the level:
    // they came from there, so that is where they are.
    expect(result.current.selectedNodeId).toBe('2')
  })

  it('dismisses an error', async () => {
    vi.mocked(api.deleteRelationship).mockRejectedValue(new Error('Nope'))
    const { result } = setup()

    await act(async () => {
      await result.current.removeRelationship('r1')
    })
    act(() => result.current.dismissError())

    expect(result.current.error).toBeNull()
  })

  it('adds a relationship returned by the server without duplicating it', async () => {
    vi.mocked(api.createRelationship).mockResolvedValue({
      id: 'r2',
      relationshipType: 'depends_on',
      sourceNodeId: '2',
      targetNodeId: '1',
      metadata: {},
    })

    const { result } = setup()

    await act(async () => {
      await result.current.connectNodes('2', '1', 'depends_on')
    })
    await act(async () => {
      await result.current.connectNodes('2', '1', 'depends_on')
    })

    // The mutation is idempotent server-side, so a retry returns the same edge and the
    // client must not draw it twice.
    expect(result.current.relationships.filter((edge) => edge.id === 'r2')).toHaveLength(1)
  })
})
