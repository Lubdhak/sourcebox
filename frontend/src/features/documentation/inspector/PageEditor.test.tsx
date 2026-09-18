import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo } from 'react'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { PageEditor } from '@/features/documentation/inspector/PageEditor'
import { usePageBody } from '@/features/documentation/inspector/usePageBody'

/**
 * The editor over a real shared document, with the socket left out.
 *
 * `usePageBody` is given a document that is already synchronised and belongs to nobody
 * else, which is the whole of what a connection provides here -- so the text these cases
 * assert on is the text a collaborator would have received, through the same parser, the
 * same serializer and the same diffing, without a server in the room.
 *
 * What is *not* tested here is typing. The document model is Plate's, and its own suites
 * cover what a keystroke does to a tree; jsdom has no editing behaviour to exercise
 * anyway. What matters at this seam is the pair of conversions and who they reach --
 * covered exhaustively in `editor/markdown.test.ts` and end to end here.
 */
function Harness({
  initial = '',
  candidates = [{ id: '42', title: 'Payment Service', nodeType: 'service' }],
  onSearchMentions = vi.fn().mockResolvedValue([]),
  onSave = vi.fn().mockResolvedValue(true),
  onDone = vi.fn(),
}: {
  initial?: string
  candidates?: { id: string; title: string; nodeType?: string }[]
  onSearchMentions?: (query: string) => Promise<{ id: string; title: string }[]>
  onSave?: (markdown: string) => Promise<boolean>
  onDone?: () => void
}) {
  const doc = useMemo(() => {
    const created = new Y.Doc()
    if (initial) created.getText('page').insert(0, initial)

    return created
  }, [])

  const page = usePageBody({
    document: { doc, synced: true, connected: true, editors: [], announceEditing: () => {} },
    // Empty, because the document above is already seeded. Seeding from storage is
    // `usePageBody`'s business and is tested there.
    blocks: [],
    saving: false,
    onSave,
  })

  return (
    <PageEditor
      page={page}
      candidates={candidates}
      onSearchMentions={onSearchMentions}
      onDone={onDone}
    />
  )
}

function surface() {
  return screen.getByRole('textbox', { name: 'Page content' })
}

function source() {
  return screen.getByLabelText('Markdown source') as HTMLTextAreaElement
}

describe('PageEditor', () => {
  it('stores nothing for a page nobody has written yet', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)

    render(<Harness onSave={onSave} />)

    // The empty line the editor keeps at the end of every document is written by the
    // serializer as a zero-width space. Saving that would put an invisible character in
    // the database, in the reader's page, and in every later comparison of the two.
    await waitFor(() => expect(surface()).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    expect(source().value).toBe('')
  })

  it('opens on the formatted page, not on Markdown', async () => {
    render(<Harness initial={'## Capture\n\nHandles **capture** and refunds.'} />)

    const page = surface()

    await waitFor(() => expect(page.querySelector('h2')?.textContent).toBe('Capture'))
    expect(page.querySelector('strong')?.textContent).toBe('capture')
    // No syntax on screen: the author never has to know what produced the heading.
    expect(page.textContent).not.toContain('##')
  })

  it('renders each of the things a documentation page is made of', async () => {
    const initial = [
      '# Payments',
      '',
      'Owned by [@Ledger](#node-7).',
      '',
      '- first',
      '- [x] done',
      '',
      '| Setting | Value |',
      '| --- | --- |',
      '| retries | 3 |',
      '',
      '```sql',
      'SELECT 1',
      '```',
      '',
      '> A caveat.',
      '',
      '---',
    ].join('\n')

    render(<Harness initial={initial} />)

    const page = surface()

    await waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('Payments'))
    expect(page.querySelector('table td')?.textContent).toBe('retries')
    expect(page.querySelector('pre.code-block')).not.toBeNull()
    expect(page.querySelector('blockquote')?.textContent).toContain('A caveat')
    expect(page.querySelector('hr')).not.toBeNull()

    // A mention keeps the href the reader's page turns into navigation.
    expect(page.querySelector('a[href="#node-7"]')?.textContent).toContain('@Ledger')

    // And the snippet is coloured by the same tokenizer the page uses, in the editor.
    expect(page.querySelector('pre [class*="hljs-"]')).not.toBeNull()
  })

  it('shows the Markdown that will be saved, and takes edits there too', async () => {
    const user = userEvent.setup()
    render(<Harness initial={'## Capture\n\nHandles capture.'} />)

    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    expect(source().value).toBe('## Capture\n\nHandles capture.')

    // Same shared text underneath, so the formatted surface has the change on the way back.
    await user.type(source(), ' Refunds too.')
    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    await waitFor(() => expect(surface().textContent).toContain('Refunds too.'))
  })

  it('indents the Markdown source with Tab rather than leaving the editor', async () => {
    const user = userEvent.setup()
    render(<Harness initial={'- first\n- second'} />)

    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    const markdown = source()

    await user.click(markdown)
    markdown.setSelectionRange(9, 9)
    await user.keyboard('{Tab}')

    expect(markdown.value).toBe('- first\n  - second')
  })

  it('takes a collaborator’s edit without being asked to re-render', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Handles capture." />)

    await waitFor(() => expect(surface().textContent).toContain('Handles capture.'))

    // Straight into the shared text, which is what arriving over the socket looks like.
    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    await user.click(source())
    await user.keyboard(' Owned by payments.')
    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    await waitFor(() => expect(surface().textContent).toContain('Owned by payments.'))
  })

  it('offers Plate’s controls, and only for the nodes a page can hold', async () => {
    render(<Harness />)

    // By label rather than by role: a mark is a toggle and a block is a button, and what
    // matters is that every icon in the bar says what it is -- a toolbar of unnamed icons
    // is unusable to anybody not looking at it.
    const labels = [
      'Bold',
      'Italic',
      'Strikethrough',
      'Inline code',
      'Heading 2',
      'Bulleted list',
      'Numbered list',
      'Task list',
      'Quote',
      'Code block',
      'Table',
      'Divider',
      'Link',
      'Table options',
    ]

    for (const label of labels) expect(screen.getByLabelText(label)).toBeDefined()

    // The set is deliberately small: every control Plate ships that this document set has
    // no node for would either do nothing or write something Markdown cannot keep.
    expect(screen.queryByLabelText(/AI/)).toBeNull()
    expect(screen.queryByLabelText(/Comment/)).toBeNull()
    expect(screen.queryByLabelText(/Emoji/)).toBeNull()
  })

  it('saves the page as Markdown on Done, byte for byte', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    const onDone = vi.fn()
    const initial = ['## Capture', '', 'Handles capture.', '', '- one', '- two'].join('\n')

    render(<Harness initial={initial} onSave={onSave} onDone={onDone} />)

    await waitFor(() => expect(surface().querySelector('h2')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Done' }))

    // Parsed, rendered, serialized -- and the same document comes out. A page that is only
    // read must not come back rewritten, which is what makes it safe to save on the way
    // out of an editor somebody opened to look at something.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(initial))
    expect(onDone).toHaveBeenCalled()
    expect(screen.getByText('Saved as you type')).toBeDefined()
  })
})
