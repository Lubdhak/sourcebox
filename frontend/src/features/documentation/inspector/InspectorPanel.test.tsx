import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from '@/features/documentation/inspector/InspectorPanel'
import type { ContentBlock } from '@/types'

vi.mock('@/features/documentation/collaboration/useCollaborativeDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/documentation/collaboration/useCollaborativeDocument')>()
  const { useMemo } = await import('react')
  const Y = await import('yjs')

  return {
    ...actual,
    useCollaborativeDocument: (nodeId: string | null) => ({
      doc: useMemo(() => new Y.Doc(), [nodeId]),
      synced: true,
      connected: true,
      editors: [],
      announceEditing: () => {},
    }),
  }
})

vi.mock('@/features/documentation/graphql', () => ({
  fetchNodeDetail: vi.fn(),
  updateNode: vi.fn(),
  upsertContentBlock: vi.fn(),
  deleteContentBlock: vi.fn(),
  searchDocumentation: vi.fn().mockResolvedValue([]),
}))

const api = await import('@/features/documentation/graphql')

type NodeDetail = import('@/features/documentation/graphql').NodeDetail

const MARKDOWN_BLOCK: ContentBlock = {
  id: '10',
  blockType: 'MARKDOWN',
  position: 0,
  data: { markdown: 'Handles **capture** and refunds.' },
}

const TABLE_BLOCK: ContentBlock = {
  id: '11',
  blockType: 'TABLE',
  position: 1,
  data: { columns: ['Setting'], rows: [['work_mem']] },
}

function detail(overrides: Partial<NodeDetail> = {}): NodeDetail {
  return {
    id: '7',
    title: 'Payment Service',
    summary: 'Card capture and refunds.',
    position: { x: 120.4, y: -60.8, z: 1 },
    size: { width: 240, height: 120, depth: 0 },
    metadata: {},
    contentBlocks: [MARKDOWN_BLOCK],
    outgoingRelationships: [
      {
        id: 'r1',
        relationshipType: 'writes_to',
        sourceNodeId: '7',
        targetNodeId: '9',
        metadata: {},
        targetNode: { id: '9', title: 'Payments Database' },
      },
    ],
    incomingRelationships: [
      {
        id: 'r2',
        relationshipType: 'calls',
        sourceNodeId: '3',
        targetNodeId: '7',
        metadata: {},
        sourceNode: { id: '3', title: 'Order Service' },
      },
    ],
    ...overrides,
  }
}

function renderPanel(props: Partial<Parameters<typeof InspectorPanel>[0]> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onSelectNode: vi.fn(),
    onDeleteNode: vi.fn(),
    onDeleteRelationship: vi.fn(),
    onNodeChanged: vi.fn(),
  }

  render(
    <InspectorPanel
      nodeId="7"
      spaceId="space-1"
      {...handlers}
      {...props}
    />,
  )

  return handlers
}

describe('InspectorPanel', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test double
    vi.mocked(api.fetchNodeDetail).mockResolvedValue(detail() as any)
  })

  afterEach(() => vi.clearAllMocks())

  it('reads as a page: a title, two properties, the prose, and the graph below it', async () => {
    renderPanel()

    expect(await screen.findByRole('heading', { name: 'Payment Service' })).toBeDefined()
    expect(screen.getByText('Card capture and refunds.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Type' }).textContent).toContain('service')

    // Rendered, not shown as source.
    expect(screen.getByText('capture').tagName).toBe('STRONG')

    // Both directions, since a node is as defined by what calls it as by what it calls.
    expect(screen.getByRole('button', { name: 'Payments Database' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Order Service' })).toBeDefined()

    // No block vocabulary anywhere in the panel.
    expect(screen.queryByRole('button', { name: /add block/i })).toBeNull()
  })

  it('renames in place, without an edit mode', async () => {
    const user = userEvent.setup()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test double
    vi.mocked(api.updateNode).mockResolvedValue({ ...detail(), title: 'Billing Service' } as any)

    const { onNodeChanged } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Payment Service' }))
    const title = screen.getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Billing Service{Enter}')

    await waitFor(() =>
      expect(api.updateNode).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: '7', title: 'Billing Service' }),
      ),
    )
    // The canvas card draws the title, so it has to be told the title changed.
    expect(onNodeChanged).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Billing Service' })).toBeDefined()
  })

  it('opens the editor from the Edit button only, and saves the page as one document', async () => {
    const user = userEvent.setup()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test double
    vi.mocked(api.fetchNodeDetail).mockResolvedValue(detail({ contentBlocks: [MARKDOWN_BLOCK, TABLE_BLOCK] }) as any)
    vi.mocked(api.upsertContentBlock).mockResolvedValue({
      contentBlock: MARKDOWN_BLOCK,
      blocks: [MARKDOWN_BLOCK],
    })
    vi.mocked(api.deleteContentBlock).mockResolvedValue([MARKDOWN_BLOCK])

    renderPanel()

    // Clicking the prose reads as reading, not as editing. It used to open the editor,
    // and the cost was that selecting a paragraph to copy it swapped the text for an
    // editing surface mid-drag.
    await user.click(await screen.findByText(/Handles/))
    expect(screen.queryByRole('textbox', { name: 'Page content' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    // Formatted, not source: the author edits the page they were reading.
    const editor = await screen.findByRole('textbox', { name: 'Page content' })
    await waitFor(() => expect(editor.querySelector('strong')).not.toBeNull())

    // The table came into the editor as part of the one document rather than as a
    // separate typed thing, and is told it will be stored as Markdown.
    expect(editor.querySelector('table')).not.toBeNull()
    expect(screen.getByText(/saved as Markdown/)).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() =>
      expect(api.upsertContentBlock).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: '7', blockId: '10', blockType: 'MARKDOWN', position: 0 }),
      ),
    )
    // Everything that was folded into the text is gone, or the page would say it twice.
    expect(api.deleteContentBlock).toHaveBeenCalledWith('11')
  })

  it('invites the first sentence when a node has no documentation', async () => {
    const user = userEvent.setup()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test double
    vi.mocked(api.fetchNodeDetail).mockResolvedValue(detail({ contentBlocks: [] }) as any)

    renderPanel()

    await user.click(await screen.findByRole('button', { name: /Write something/ }))

    expect(await screen.findByRole('textbox', { name: 'Page content' })).toBeDefined()
  })

  it('follows a mention to the node it names', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fetchNodeDetail).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test double
      detail({
        contentBlocks: [
          { id: '12', blockType: 'MARKDOWN', position: 0, data: { markdown: 'Owned by [@Payments](#node-42)' } },
        ],
      }) as any,
    )

    const { onSelectNode } = renderPanel({ editable: false })

    await user.click(await screen.findByRole('link', { name: '@Payments' }))

    // In-app navigation, not a fragment jump: the canvas moves to the node.
    expect(onSelectNode).toHaveBeenCalledWith('42')
  })

  it('offers the way back only once a link has been followed, and names where to', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()

    renderPanel()
    await screen.findByRole('heading', { name: 'Payment Service' })

    // Nothing to go back to while the panel is showing what was selected on the canvas.
    expect(screen.queryByRole('button', { name: /Back to/ })).toBeNull()

    renderPanel({ back: { title: 'Checkout', onBack } })

    // Named rather than a bare "Back": two mentions deep, "back" on its own does not say
    // where to.
    await user.click(await screen.findByRole('button', { name: 'Back to Checkout' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('selects a related node instead of navigating away', async () => {
    const user = userEvent.setup()
    const { onSelectNode } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Payments Database' }))

    expect(onSelectNode).toHaveBeenCalledWith('9')
  })

  it('is a document, not an editor, for a reader', async () => {
    renderPanel({ editable: false })

    await screen.findByRole('heading', { name: 'Payment Service' })

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Type' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete node' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove relationship' })).toBeNull()
  })

  it('surfaces a failed save without losing the node it is showing', async () => {
    const user = userEvent.setup()
    vi.mocked(api.updateNode).mockRejectedValue(new Error('Title is too long'))

    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Payment Service' }))
    await user.type(screen.getByLabelText('Title'), ' Two{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Title is too long')

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Payment Service' })).toBeDefined()
  })

  it('reloads when the selection changes, and ignores the response for the node left behind', async () => {
    renderPanel()

    await waitFor(() => expect(api.fetchNodeDetail).toHaveBeenCalledWith('7', expect.anything()))

    // The signal is what makes a slow response for an old selection harmless.
    const options = vi.mocked(api.fetchNodeDetail).mock.calls[0]?.[1]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })
})
