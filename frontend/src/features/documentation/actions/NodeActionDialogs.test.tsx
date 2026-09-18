import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteNodeDialog, DuplicateNodeDialog } from '@/features/documentation/actions/NodeActionDialogs'
import type { DeletionImpact, DocumentationNode } from '@/types'

vi.mock('@/features/documentation/graphql', () => ({
  fetchDeletionImpact: vi.fn(),
}))

const api = await import('@/features/documentation/graphql')

function node(overrides: Partial<DocumentationNode> = {}): DocumentationNode {
  return {
    id: 'n1',
    nodeType: 'service',
    title: 'Order Service',
    summary: null,
    position: { x: 0, y: 0, z: 0 },
    size: { width: 240, height: 120, depth: 0 },
    metadata: {},
    ...overrides,
  }
}

function impact(overrides: Partial<DeletionImpact> = {}): DeletionImpact {
  return {
    node: { id: 'n1', title: 'Order Service' },
    descendants: [],
    retained: [],
    relationships: [],
    relationshipCount: 0,
    descendantRelationshipCount: 0,
    blockCount: 0,
    descendantBlockCount: 0,
    ...overrides,
  }
}

describe('DeleteNodeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names every relationship instead of counting them', async () => {
    vi.mocked(api.fetchDeletionImpact).mockResolvedValue(
      impact({
        relationships: [
          { id: 'r1', relationshipType: 'calls', sourceTitle: 'Payments Gateway', targetTitle: 'Order Service' },
          { id: 'r2', relationshipType: 'contains', sourceTitle: 'Order Service', targetTitle: 'orders table' },
        ],
        relationshipCount: 2,
        blockCount: 5,
      }),
    )

    render(<DeleteNodeDialog node={node()} open onOpenChange={() => {}} onConfirm={() => {}} />)

    // The summary still gives the shape of it...
    expect(await screen.findByText('5 content blocks and 2 relationships would go with it.')).toBeDefined()

    // ...but the decision is made on the edges themselves, which is why each one is
    // written out with both of its ends and its verb.
    expect(screen.getByText('Payments Gateway')).toBeDefined()
    expect(screen.getByText('calls')).toBeDefined()
    expect(screen.getByText('orders table')).toBeDefined()
    expect(screen.getByText('contains')).toBeDefined()
  })

  it('lists the nodes inside and offers both ways out', async () => {
    vi.mocked(api.fetchDeletionImpact).mockResolvedValue(
      impact({
        descendants: [
          { id: 'n2', title: 'orders table', nodeType: 'database' },
          { id: 'n3', title: 'Stripe Webhook Handler', nodeType: 'service' },
        ],
        relationshipCount: 1,
        relationships: [
          { id: 'r1', relationshipType: 'contains', sourceTitle: 'Platform', targetTitle: 'Order Service' },
        ],
      }),
    )

    const onConfirm = vi.fn()
    render(
      <DeleteNodeDialog node={node({ parents: [{ id: 'p1', title: 'Platform', parentNodeId: null }] })} open onOpenChange={() => {}} onConfirm={onConfirm} />,
    )

    expect(await screen.findByText('2 nodes inside it')).toBeDefined()
    expect(screen.getByText('Stripe Webhook Handler')).toBeDefined()
    // Where the survivors go, said in the dialog rather than discovered afterwards.
    expect(screen.getByText(/moves what is inside up into “Platform”/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Delete only this node' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('says which nodes survive because they live somewhere else too', async () => {
    vi.mocked(api.fetchDeletionImpact).mockResolvedValue(
      impact({ retained: [{ id: 'n4', title: 'users table', nodeType: 'database' }] }),
    )

    render(<DeleteNodeDialog node={node()} open onOpenChange={() => {}} onConfirm={() => {}} />)

    expect(await screen.findByText(/also lives elsewhere/)).toBeDefined()
    expect(screen.getByText('users table')).toBeDefined()
  })

  it('deletes everything inside only when that button is the one pressed', async () => {
    vi.mocked(api.fetchDeletionImpact).mockResolvedValue(
      impact({ descendants: [{ id: 'n2', title: 'orders table', nodeType: 'database' }] }),
    )

    const onConfirm = vi.fn()
    render(<DeleteNodeDialog node={node()} open onOpenChange={() => {}} onConfirm={onConfirm} />)

    await userEvent.click(await screen.findByRole('button', { name: /Delete all 2/ }))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('keeps the node it is about when the impact cannot be read', async () => {
    vi.mocked(api.fetchDeletionImpact).mockRejectedValue(new Error('Gone'))

    render(<DeleteNodeDialog node={node()} open onOpenChange={() => {}} onConfirm={() => {}} />)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Gone'))
    // Still named, and still cancellable: a failed lookup must not strand the dialog.
    expect(screen.getByText('Delete “Order Service”?')).toBeDefined()
  })
})

describe('DuplicateNodeDialog', () => {
  it('offers the copy with or without what is inside', async () => {
    const onConfirm = vi.fn()
    render(
      <DuplicateNodeDialog node={node({ childCount: 3 })} open onOpenChange={() => {}} onConfirm={onConfirm} />,
    )

    expect(screen.getByText(/It contains 3 nodes/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Just this node' }))
    expect(onConfirm).toHaveBeenCalledWith(false)

    await userEvent.click(screen.getByRole('button', { name: 'With everything inside' }))
    expect(onConfirm).toHaveBeenLastCalledWith(true)
  })
})
