import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { PageEditor } from '@/features/documentation/inspector/PageEditor'
import { usePageBody } from '@/features/documentation/inspector/usePageBody'

/**
 * The editor over a real shared document, with the socket left out.
 *
 * `usePageBody` is given a document that is already synchronised and belongs to nobody
 * else, which is the whole of what a connection provides here -- so the text these cases
 * assert on is the text a collaborator would have received, produced by the same diffing
 * and the same serializer, without a server in the room.
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

/** The formatted surface, which is what the editor opens on. */
function surface() {
  return screen.getByRole('textbox', { name: 'Page content' })
}

function source() {
  return screen.getByLabelText('Markdown source') as HTMLTextAreaElement
}

async function openSource(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Markdown' }))

  return source()
}

/** Puts the caret in the surface, which a formatting command needs before it can format. */
function selectAll(element: Element) {
  const range = document.createRange()
  range.selectNodeContents(element)

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * The caret at the end of the text, where clicking past the last word puts it.
 *
 * Done by hand because jsdom's click does not move a caret: without this, typing lands
 * outside the paragraph and the serializer correctly reports a second one.
 */
function caretAtEnd(element: Element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let last: Node | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node

  const range = document.createRange()
  if (last) range.setStart(last, last.textContent?.length ?? 0)
  else range.selectNodeContents(element)
  range.collapse(true)

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('PageEditor', () => {
  beforeEach(() => {
    // jsdom has no editing commands, so the rich surface's calls are recorded rather
    // than performed: what is under test there is the mapping from a button to a command,
    // not the browser's implementation of it.
    document.execCommand = vi.fn().mockReturnValue(true)
  })

  it('opens on the formatted page, not on Markdown', async () => {
    render(<Harness initial={'## Capture\n\nHandles **capture** and refunds.'} />)

    const page = surface()

    await waitFor(() => expect(page.querySelector('h2')?.textContent).toBe('Capture'))
    expect(page.querySelector('strong')?.textContent).toBe('capture')
    // No syntax on screen: the author never has to know what produced the heading.
    expect(page.textContent).not.toContain('##')
    expect(page.getAttribute('contenteditable')).toBe('true')
  })

  it('asks the browser for the formatting the button names', async () => {
    const user = userEvent.setup()
    render(<Harness initial="capture and refunds" />)

    selectAll(surface())
    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, undefined)

    await user.click(screen.getByRole('button', { name: 'Heading 2' }))
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<h2>')

    await user.click(screen.getByRole('button', { name: 'Bulleted list' }))
    expect(document.execCommand).toHaveBeenCalledWith('insertUnorderedList', false, undefined)
  })

  it('writes what was typed back as Markdown', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(<Harness initial="Handles capture." onSave={onSave} />)

    const page = surface()
    await user.click(page)
    caretAtEnd(page)
    await user.keyboard(' Owned by payments.')

    await user.click(screen.getByRole('button', { name: 'Done' }))

    // Serialized from the rendered page, so this is the round trip, not an echo.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Handles capture. Owned by payments.'))
  })

  it('keeps the structure of a page it did not write', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    const initial = ['## Capture', '', '| Setting | Value |', '| --- | --- |', '| retries | 3 |'].join('\n')

    render(<Harness initial={initial} onSave={onSave} />)

    await waitFor(() => expect(surface().querySelector('table')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Done' }))

    // A table survives being rendered and serialized again. Round-tripping a page that
    // was only read must not rewrite it.
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0]?.[0] as string
    expect(saved).toContain('## Capture')
    expect(saved).toContain('| retries | 3 |')
  })

  it('shows the Markdown that will be saved, and takes edits there too', async () => {
    const user = userEvent.setup()
    render(<Harness initial={'## Capture\n\nHandles capture.'} />)

    const markdown = await openSource(user)
    expect(markdown.value).toBe('## Capture\n\nHandles capture.')

    // Same shared text underneath, so the formatted surface has the change on the way back.
    await user.type(markdown, ' Refunds too.')
    await user.click(screen.getByRole('button', { name: 'Markdown' }))

    await waitFor(() => expect(surface().textContent).toContain('Refunds too.'))
  })

  it('formats Markdown as syntax when that is the surface in front of you', async () => {
    const user = userEvent.setup()
    render(<Harness initial="capture and refunds" />)

    const markdown = await openSource(user)
    markdown.setSelectionRange(0, 7)
    await user.click(screen.getByRole('button', { name: 'Bold' }))

    expect(markdown.value).toBe('**capture** and refunds')
  })

  it('formats from the keyboard, with the shortcut people already know', async () => {
    const user = userEvent.setup()
    render(<Harness initial="capture" />)

    const markdown = await openSource(user)
    await user.click(markdown)
    markdown.setSelectionRange(0, 7)
    await user.keyboard('{Meta>}b{/Meta}')

    expect(markdown.value).toBe('**capture**')
  })

  it('continues a list on Enter and ends it on an empty item', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const markdown = await openSource(user)
    await user.click(markdown)
    await user.type(markdown, '- capture{Enter}refund{Enter}{Enter}')

    expect(markdown.value).toBe('- capture\n- refund\n')
  })

  it('offers nodes after @ and inserts the one chosen as a mention', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Owned by " />)

    const markdown = await openSource(user)
    await user.click(markdown)
    await user.type(markdown, '@Pay')

    await user.click(await screen.findByRole('option', { name: /Payment Service/ }))

    expect(markdown.value).toBe('Owned by [@Payment Service](#node-42) ')
  })

  it('takes the highlighted node on Enter, so a mention never needs the mouse', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const markdown = await openSource(user)
    await user.click(markdown)
    await user.type(markdown, '@Payment')
    await screen.findByRole('option', { name: /Payment Service/ })
    await user.keyboard('{Enter}')

    expect(markdown.value).toBe('[@Payment Service](#node-42) ')
  })

  it('mentions a node from the formatted surface as a link, not as syntax', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(<Harness initial="Owned by " onSave={onSave} />)

    const page = surface()
    await user.click(page)
    caretAtEnd(page)
    await user.keyboard('@Pay')

    await user.click(await screen.findByRole('option', { name: /Payment Service/ }))

    await waitFor(() => expect(page.querySelector('a')?.textContent).toBe('@Payment Service'))
    expect(page.querySelector('a')?.getAttribute('href')).toBe('#node-42')

    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.stringContaining('[@Payment Service](#node-42)')),
    )
  })

  it('asks how big the table should be, and builds that', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const markdown = await openSource(user)
    await user.click(screen.getByRole('button', { name: 'Table' }))

    // A shape, not a guess: the grid is the question.
    const form = screen.getByRole('dialog', { name: 'Insert table' })
    await user.click(within(form).getByRole('button', { name: '4 by 3' }))

    const [header, divider, ...rows] = markdown.value.trim().split('\n')
    expect(header).toBe('| Column 1 | Column 2 | Column 3 | Column 4 |')
    expect(divider).toContain('---')
    expect(rows).toHaveLength(3)
  })

  it('takes an exact table size for the ones the grid cannot reach', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const markdown = await openSource(user)
    await user.click(screen.getByRole('button', { name: 'Table' }))

    const form = screen.getByRole('dialog', { name: 'Insert table' })
    const columns = within(form).getByLabelText('Columns')
    await user.clear(columns)
    await user.type(columns, '12')
    await user.click(within(form).getByRole('button', { name: 'Insert' }))

    expect(markdown.value).toContain('| Column 12 |')
  })

  it('asks which language a code block is in, and fences it with that', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const markdown = await openSource(user)
    await user.click(screen.getByRole('button', { name: 'Code block' }))

    const form = screen.getByRole('dialog', { name: 'Insert code block' })
    await user.selectOptions(within(form).getByLabelText('Language'), 'sql')
    await user.click(within(form).getByRole('button', { name: 'Insert' }))

    // The language after the fence is the whole point: it is what the reader's page
    // highlights by, and in the formatted surface there is no fence to type it after.
    expect(markdown.value).toContain('```sql\n')
  })

  it('makes Enter inside a code block a newline, not a new block', async () => {
    const user = userEvent.setup()
    render(<Harness initial={'```python\nfirst\n```'} onSave={vi.fn().mockResolvedValue(true)} />)

    const page = surface()
    await waitFor(() => expect(page.querySelector('pre code')).not.toBeNull())

    await user.click(page)
    caretAtEnd(page.querySelector('pre code')!)
    await user.keyboard('{Enter}')

    // Left to the browser, Enter here ends the block or splits it in two -- which is how
    // one snippet becomes three. A code block that cannot hold a second line is not one.
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '\n')
    expect(document.execCommand).not.toHaveBeenCalledWith('insertParagraph', false, undefined)
  })

  it('keeps a multi-line code block intact through the editor', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    const fence = '```python\nfirst = 1\nsecond = 2\n```'

    render(<Harness initial={fence} onSave={onSave} />)

    await waitFor(() => expect(surface().querySelector('pre code')?.textContent).toContain('second'))

    // Coloured, numbered and labelled here, exactly as on the page. An editor that shows
    // a plain grey box where the reader sees highlighted code is an editor people stop
    // trusting, and the numbers not being saved is the serializer's job rather than a
    // reason to leave them out.
    const block = surface().querySelector('pre.code-block')!
    expect(block.getAttribute('data-language')).toBe('python')
    expect(block.querySelector('.code-gutter')?.textContent).toBe('1\n2')
    expect(block.querySelector('[class^="hljs-"]')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    // Serialized back to the same document: the gutter is presentation and does not come
    // with it.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(fence))
  })

  it('asks where a link goes rather than inserting a placeholder to hunt for', async () => {
    const user = userEvent.setup()
    render(<Harness initial="see " />)

    const markdown = await openSource(user)
    markdown.setSelectionRange(4, 4)

    await user.click(screen.getByRole('button', { name: 'Link' }))
    const form = screen.getByRole('dialog', { name: 'Insert link' })

    const target = within(form).getByLabelText('Link to')
    await user.clear(target)
    await user.type(target, 'https://runbook.internal{Enter}')

    expect(markdown.value).toBe('see [label](https://runbook.internal)')
  })

  it('inserts the table into the formatted page as a table', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Table' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Insert table' })).getByRole('button', { name: '2 by 2' }),
    )

    // jsdom performs no editing commands, so what is checked is the request: the size the
    // author chose, as HTML, with a caret position in every empty cell.
    const html = vi.mocked(document.execCommand).mock.calls.at(-1)?.[2] as string
    expect(html).toContain('<th>Column 2</th>')
    expect(html.match(/<tr>/g)).toHaveLength(3)
    expect(html).toContain('<td><br></td>')
  })

  it('searches the whole space once the query is worth a round trip', async () => {
    const user = userEvent.setup()
    const onSearchMentions = vi
      .fn()
      .mockResolvedValue([{ id: '9', title: 'Payments Database', nodeType: 'database' }])

    render(<Harness candidates={[]} onSearchMentions={onSearchMentions} />)

    const markdown = await openSource(user)
    await user.click(markdown)
    await user.type(markdown, '@Payments')

    await waitFor(() => expect(onSearchMentions).toHaveBeenCalledWith('Payments'))
    expect(await screen.findByRole('option', { name: /Payments Database/ })).toBeDefined()
  })

  it('closes the picker on Escape without leaving the editor', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<Harness onDone={onDone} />)

    const markdown = await openSource(user)
    await user.click(markdown)
    await user.type(markdown, '@Payment')
    await screen.findByRole('option', { name: /Payment Service/ })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('option')).toBeNull()
    expect(onDone).not.toHaveBeenCalled()

    // A second Escape, with nothing open, is the way out of the editor.
    await user.keyboard('{Escape}')
    expect(onDone).toHaveBeenCalled()
  })
})
