import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphState } from '@/features/documentation/useGraphState'
import type { DocumentationNode, Layer, SpaceGraph } from '@/types'

// The network is the boundary being mocked, not the behaviour: every assertion below is
// about what the hook does locally and what it sends, which is the whole contract of an
// optimistic client.
vi.mock('@/features/documentation/graphql', () => ({
  fetchSpaceGraph: vi.fn(),
  moveNodes: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
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
    nodeType: 'service',
    title: `Node ${id}`,
    summary: null,
    position: { x, y, z: 0 },
    size: { width: 240, height: 120, depth: 0 },
    metadata: {},
    layerId: null,
  }
}

const LAYERS: Layer[] = [{ id: '1', index: 0, name: 'System', description: null, nodeCount: 2 }]

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

function setup() {
  return renderHook(() =>
    useGraphState({ spaceId: SPACE_ID, initialGraph: graph(), initialLayers: LAYERS }),
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
      layers: LAYERS,
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

    // Let the mount refetch settle, so its state update does not land after the test.
    await waitFor(() => expect(api.fetchSpaceGraph).toHaveBeenCalled())
  })

  it('refetches on mount, because the snapshot is already stale', async () => {
    setup()

    await waitFor(() => expect(api.fetchSpaceGraph).toHaveBeenCalled())
    expect(vi.mocked(api.fetchSpaceGraph).mock.calls[0]?.[0]).toMatchObject({ id: SPACE_ID })
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

  it('asks the server to take the contents too only when told to', async () => {
    vi.mocked(api.deleteNode).mockResolvedValue('1')
    const { result } = setup()

    await act(async () => {
      await result.current.removeNode('1')
    })
    await act(async () => {
      await result.current.removeNode('2', true)
    })

    expect(vi.mocked(api.deleteNode).mock.calls).toEqual([
      ['1', false],
      ['2', true],
    ])
  })

  it('lands with a card selected when the keyboard asked to go in', async () => {
    const { result } = setup()
    await waitFor(() => expect(api.fetchSpaceGraph).toHaveBeenCalled())

    await act(async () => {
      await result.current.dive('1', { selectOnArrival: true })
    })

    // The first card in reading order: node 1 sits at 0,0 and node 2 at 100,0.
    expect(result.current.selectedNodeId).toBe('1')
  })

  it('leaves the selection alone when a mouse went in', async () => {
    const { result } = setup()
    await waitFor(() => expect(api.fetchSpaceGraph).toHaveBeenCalled())

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
      layers: LAYERS,
      graph: { ...graph(), focusNode: node('2', 100, 0), trail: [] },
    })

    const { result } = setup()
    await waitFor(() => expect(result.current.focusNodeId).toBe('2'))

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

  it('filters by layer on the server rather than hiding nodes locally', async () => {
    const { result } = setup()

    await act(async () => {
      result.current.setLayerFilter('1')
    })

    await waitFor(() =>
      expect(vi.mocked(api.fetchSpaceGraph).mock.calls.at(-1)?.[0]).toMatchObject({ layerId: '1' }),
    )
    expect(result.current.layerFilter).toBe('1')
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
