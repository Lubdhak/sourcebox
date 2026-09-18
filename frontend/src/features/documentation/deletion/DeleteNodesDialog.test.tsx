import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteNodesDialog } from '@/features/documentation/deletion/DeleteNodesDialog'
import type { NodeDeletionImpact } from '@/types'

vi.mock('@/features/documentation/graphql', () => ({
  fetchNodesDeletionImpact: vi.fn(),
  deleteNodes: vi.fn(),
}))

const api = await import('@/features/documentation/graphql')

function impact(overrides: Partial<NodeDeletionImpact> = {}): NodeDeletionImpact {
  return {
    digest: 'digest-1',
    selected: [{ id: 'n1', title: 'Authentication', reason: null }],
    orphans: [],
    retained: [],
    references: [],
    selectedCount: 1,
    orphanCount: 0,
    referenceCount: 0,
    additionalDeleteCount: 0,
    deleteCount: 1,
    affectedCount: 1,
    blockCount: 0,
    ...overrides,
  }
}

/** The impact arrives asynchronously, so almost every assertion waits for it. */
async function ready() {
  await waitFor(() => expect(screen.queryByText('Calculating impact…')).toBeNull())
}

describe('DeleteNodesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.fetchNodesDeletionImpact).mockResolvedValue(impact())
    vi.mocked(api.deleteNodes).mockResolvedValue({
      deletedNodeIds: ['n1'],
      changed: false,
      impact: null,
    })
  })

  it('names a single node and counts a selection, from the same component', async () => {
    const { unmount } = render(
      <DeleteNodesDialog
        nodeIds={['n1']}
        open
        onOpenChange={() => {}}
        titles={{ n1: 'Authentication' }}
      />,
    )

    expect(await screen.findByText('Delete “Authentication”')).toBeDefined()
    expect(screen.getByText(/this node and anything connected to it/)).toBeDefined()
    unmount()

    vi.mocked(api.fetchNodesDeletionImpact).mockResolvedValue(
      impact({ selectedCount: 18, deleteCount: 18 }),
    )

    render(<DeleteNodesDialog nodeIds={Array.from({ length: 18 }, (_, i) => `n${i}`)} open onOpenChange={() => {}} />)

    expect(await screen.findByText('Delete 18 nodes')).toBeDefined()
    expect(screen.getByText(/these nodes and anything connected to them/)).toBeDefined()
  })

  it('shows the impact the server calculated rather than deriving it', async () => {
    vi.mocked(api.fetchNodesDeletionImpact).mockResolvedValue(
      impact({ selectedCount: 18, referenceCount: 43, orphanCount: 7, deleteCount: 18 }),
    )

    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} />)
    await ready()

    expect(screen.getByText('18')).toBeDefined()
    expect(screen.getByText('43')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
    // Soft delete is the default, so references are kept and the wording says so.
    expect(screen.getByText('references preserved')).toBeDefined()
  })

  it('recalculates when a policy changes, and rewords the impact with it', async () => {
    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} />)
    await ready()

    expect(api.fetchNodesDeletionImpact).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.fetchNodesDeletionImpact).mock.calls[0]?.[0]).toMatchObject({
      deletionMode: 'SOFT',
      referencePolicy: 'PRESERVE',
      orphanPolicy: 'KEEP',
    })

    await userEvent.click(screen.getByRole('radio', { name: /Hard delete/ }))
    await ready()

    // Choosing hard delete drags the reference policy with it, because preserving a
    // pointer to a destroyed row would leave a link to nothing.
    await waitFor(() =>
      expect(vi.mocked(api.fetchNodesDeletionImpact).mock.calls.at(-1)?.[0]).toMatchObject({
        deletionMode: 'HARD',
        referencePolicy: 'REMOVE',
      }),
    )
    expect(screen.getByText('references removed')).toBeDefined()
  })

  it('escalates the warning for a hard delete', async () => {
    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} />)
    await ready()

    expect(screen.queryByText('This cannot be undone.')).toBeNull()

    await userEvent.click(screen.getByRole('radio', { name: /Hard delete/ }))
    await ready()

    expect(screen.getByText('This cannot be undone.')).toBeDefined()
    expect(screen.getByRole('button', { name: /Permanently delete/ })).toBeDefined()
  })

  it('demands a typed word only when a hard delete is large', async () => {
    vi.mocked(api.fetchNodesDeletionImpact).mockResolvedValue(
      impact({ selectedCount: 18, deleteCount: 18 }),
    )

    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} />)
    await ready()

    await userEvent.click(screen.getByRole('radio', { name: /Hard delete/ }))
    await ready()

    const confirm = screen.getByRole('button', { name: /Permanently delete/ })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    await userEvent.type(screen.getByLabelText(/Type DELETE to confirm/), 'DELETE')
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false))
  })

  it('sends the policy and the reviewed digest when confirming', async () => {
    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} />)
    await ready()

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }))

    await waitFor(() =>
      expect(api.deleteNodes).toHaveBeenCalledWith({
        nodeIds: ['n1'],
        deletionMode: 'SOFT',
        referencePolicy: 'PRESERVE',
        orphanPolicy: 'KEEP',
        expectedDigest: 'digest-1',
      }),
    )
  })

  it('reports a graph that changed underneath, and redraws the fresh impact', async () => {
    vi.mocked(api.deleteNodes).mockResolvedValue({
      deletedNodeIds: null,
      changed: true,
      impact: impact({ digest: 'digest-2', selectedCount: 2, deleteCount: 2 }),
    })

    const onDeleted = vi.fn()
    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} onDeleted={onDeleted} />)
    await ready()

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }))

    expect(await screen.findByText(/changed while you were reviewing/)).toBeDefined()
    // Nothing was destroyed, and the caller is not told anything was.
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('refuses to delete when the impact could not be calculated', async () => {
    vi.mocked(api.fetchNodesDeletionImpact).mockRejectedValue(new Error('Gone'))

    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} />)

    expect(await screen.findByText("Couldn't calculate deletion impact.")).toBeDefined()
    expect(screen.getByText('No changes have been made.')).toBeDefined()

    // The destructive action is unavailable without a valid impact, which is the rule the
    // whole preview flow exists to enforce.
    expect(screen.getByRole('button', { name: /Delete/ }).hasAttribute('disabled')).toBe(true)
  })

  it('expands the affected nodes on request, grouped by what happens to them', async () => {
    vi.mocked(api.fetchNodesDeletionImpact).mockResolvedValue(
      impact({
        orphans: [{ id: 'n2', title: 'Google OAuth', reason: 'Its only parent is being deleted' }],
        orphanCount: 1,
        references: [
          {
            id: 'mention-1-1',
            kind: 'mention',
            sourceId: 'n9',
            sourceTitle: 'Billing',
            targetId: 'n1',
            targetTitle: 'Authentication',
          },
        ],
        referenceCount: 1,
      }),
    )

    render(<DeleteNodesDialog nodeIds={['n1']} open onOpenChange={() => {}} />)
    await ready()

    // Collapsed by default: a bulk deletion is one decision, not eighteen.
    expect(screen.queryByText('Google OAuth')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /View affected nodes/ }))

    expect(await screen.findByText('Google OAuth')).toBeDefined()
    expect(screen.getByText('Billing')).toBeDefined()
    expect(screen.getByText('mention')).toBeDefined()
  })

  it('does not fetch anything while closed', () => {
    render(<DeleteNodesDialog nodeIds={['n1']} open={false} onOpenChange={() => {}} />)

    expect(api.fetchNodesDeletionImpact).not.toHaveBeenCalled()
  })
})
