import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo } from 'react'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { PageEditor } from '@/features/documentation/inspector/PageEditor'
import { usePageBody } from '@/features/documentation/inspector/usePageBody'
import type { ContentBlock } from '@/types'

/**
 * The editor over a real collaborative document, with the socket left out.
 *
 * ### Architecture change
 *
 * The canonical CRDT is now a Y.Array inside the Y.Doc, managed by @platejs/yjs.
 * Markdown is no longer the collaborative source of truth — it is derived from
 * the Plate document tree on demand.
 *
 * The harness reflects this:
 *   - `initial` is passed as a content block (the stored Markdown from the DB),
 *     not inserted directly into a Y.Text.
 *   - usePlateYjsEditor seeds the Y.Doc from that stored Markdown on first render
 *     (via the election mechanism, settle time 400 ms).
 *   - Tests use `waitFor` to wait for the seeding to complete and the editor to
 *     reflect the initial content.
 *
 * What is tested here is the boundary between the persistence layer (usePageBody),
 * the Yjs binding (usePlateYjsEditor), and the editor UI (PageEditor): that the
 * right Markdown reaches the right place at the right time.
 *
 * What is NOT tested here is the Plate document model itself — its own suites
 * cover what a keystroke does to a tree, and jsdom has no editing behaviour to
 * exercise anyway.
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
  const doc = useMemo(() => new Y.Doc(), [])

  /*
    The initial content comes from content_blocks (stored Markdown), not from
    the Y.Doc. usePlateYjsEditor seeds the Y.Doc from stored on first render.
  */
  const blocks = useMemo<ContentBlock[]>(
    () =>
      initial
        ? [{ id: '1', blockType: 'MARKDOWN' as const, data: { markdown: initial }, position: 0 }]
        : [],
    [initial],
  )

  const page = usePageBody({
    document: { doc, synced: true, connected: true, editors: [], announceEditing: () => {} },
    blocks,
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

    // Wait for the editor to mount (no seeding happens — nothing to seed from).
    await waitFor(() => expect(surface()).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    /*
      An empty editor serialises to an empty string (after tidy() strips the
      zero-width space Plate uses for the trailing block).
    */
    expect(source().value).toBe('')
  })

  it('opens on the formatted page, not on Markdown', async () => {
    /*
      The Y.Doc is seeded from `initial` (stored Markdown) by usePlateYjsEditor.
      The seeding has a 400 ms settle so the test waits for the heading to appear.
    */
    render(<Harness initial={'## Capture\n\nHandles **capture** and refunds.'} />)

    const page = surface()

    await waitFor(() => expect(page.querySelector('h2')?.textContent).toBe('Capture'), {
      timeout: 2000,
    })
    expect(page.querySelector('strong')?.textContent).toBe('capture')
    // No Markdown syntax visible in the rich editor.
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

    await waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('Payments'), {
      timeout: 2000,
    })
    expect(page.querySelector('table td')?.textContent).toBe('retries')
    expect(page.querySelector('pre.code-block')).not.toBeNull()
    expect(page.querySelector('blockquote')?.textContent).toContain('A caveat')
    expect(page.querySelector('hr')).not.toBeNull()

    // A mention keeps the href the reader's page turns into navigation.
    expect(page.querySelector('a[href="#node-7"]')?.textContent).toContain('@Ledger')

    // The snippet is coloured by the same tokenizer the page uses.
    expect(page.querySelector('pre [class*="hljs-"]')).not.toBeNull()
  })

  it('shows the Markdown that will be saved when switching to Markdown mode', async () => {
    const user = userEvent.setup()
    render(<Harness initial={'## Capture\n\nHandles capture.'} />)

    // Wait for seeding and rendering.
    await waitFor(() => expect(surface().querySelector('h2')?.textContent).toBe('Capture'), {
      timeout: 2000,
    })

    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    /*
      The Markdown textarea is initialised from the current Plate state,
      serialised on mode-enter. The round trip must preserve the original text.
    */
    expect(source().value).toBe('## Capture\n\nHandles capture.')
  })

  it('indents the Markdown source with Tab rather than leaving the editor', async () => {
    const user = userEvent.setup()
    render(<Harness initial={'- first\n- second'} />)

    await waitFor(() => expect(surface()).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    const markdown = source()

    await user.click(markdown)
    markdown.setSelectionRange(9, 9)
    await user.keyboard('{Tab}')

    expect(markdown.value).toBe('- first\n  - second')
  })

  it(`offers Plate's controls, and only for the nodes a page can hold`, async () => {
    render(<Harness />)

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

    // The set is deliberately small.
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

    // Wait for the seeded content to render.
    await waitFor(() => expect(surface().querySelector('h2')).not.toBeNull(), { timeout: 2000 })

    await user.click(screen.getByRole('button', { name: 'Done' }))

    /*
      Parsed from stored Markdown, rendered, and serialised back — the round trip
      must produce the same document. A page that is only read must not come back
      rewritten, which is what makes it safe to save on the way out of an editor
      somebody opened only to look at something.
    */
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(initial))
    expect(onDone).toHaveBeenCalled()
  })

  it('applies a Markdown mode edit to the Plate document on exit', async () => {
    const user = userEvent.setup()
    render(<Harness initial={'Handles capture.'} />)

    await waitFor(() => expect(surface().textContent).toContain('Handles capture.'), {
      timeout: 2000,
    })

    // Enter Markdown mode and make edits.
    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    await user.click(source())
    await user.keyboard(' Refunds too.')

    // The debounced apply sends the Markdown to the Plate editor; wait for it.
    // Then toggle back to rich mode.
    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    // After switching back, the rich editor shows the updated text.
    await waitFor(() => expect(surface().textContent).toContain('Refunds too.'), {
      timeout: 2000,
    })
  })
})
