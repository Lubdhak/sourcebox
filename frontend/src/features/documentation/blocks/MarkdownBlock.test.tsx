import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownBlock } from '@/features/documentation/blocks/MarkdownBlock'

/**
 * The reader's page, which is also the shape the editor renders.
 *
 * Most of this is about the two ways a document can hurt somebody: Markdown permits raw
 * HTML by specification, and a link's href is user input. The rest is the page's own
 * behaviour -- code blocks arrive coloured and numbered, and a mention moves the canvas
 * instead of jumping to a fragment.
 */
describe('MarkdownBlock', () => {
  it('renders formatting', () => {
    render(<MarkdownBlock data={{ markdown: '## Payments\n\nBilled **monthly**.' }} />)

    expect(screen.getByRole('heading', { name: 'Payments' })).toBeDefined()
    expect(screen.getByText('monthly').tagName).toBe('STRONG')
  })

  it('strips script tags and event handlers from user-authored Markdown', () => {
    // This content is written by one user and read by another. The sanitizer is the only
    // thing between those two facts and stored XSS.
    const hostile = [
      '<script>window.__pwned = true</script>',
      '<img src=x onerror="window.__pwned = true">',
      'Safe text',
    ].join('\n\n')

    const { container } = render(<MarkdownBlock data={{ markdown: hostile }} />)

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(screen.getByText(/Safe text/)).toBeDefined()
  })

  it('opens an outside link safely', () => {
    render(<MarkdownBlock data={{ markdown: '[docs](https://example.com)' }} />)

    const link = screen.getByRole('link', { name: 'docs' })
    // Without noopener the opened page can navigate this one via window.opener.
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('refuses a javascript: URL', () => {
    // eslint-disable-next-line no-script-url -- the point of the test
    render(<MarkdownBlock data={{ markdown: '[run](javascript:alert(1))' }} />)

    expect(screen.queryByRole('link')?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('draws a fenced code block coloured and numbered, with its language named', () => {
    const { container } = render(
      // A multi-line fence, because one line proves nothing about a gutter.
      <MarkdownBlock data={{ markdown: '```sql\nSELECT id\nFROM orders\n```' }} />,
    )

    const block = container.querySelector('pre.code-block')!
    expect(block.getAttribute('data-language')).toBe('sql')
    expect(block.querySelector('.hljs-keyword')?.textContent).toBe('SELECT')
    expect(block.querySelector('.code-gutter')?.textContent).toBe('1\n2')
    expect(block.querySelector('code')?.textContent).toBe('SELECT id\nFROM orders')
  })

  it('navigates rather than following the link, for a mention of another node', async () => {
    const user = userEvent.setup()
    const onNavigateToNode = vi.fn()

    render(
      <MarkdownBlock
        data={{ markdown: 'Owned by [@Payment Service](#node-42).' }}
        onNavigateToNode={onNavigateToNode}
      />,
    )

    const mention = screen.getByRole('link', { name: '@Payment Service' })
    // A mention stays in this tab: it points at a node in this space, and opening a
    // second copy of the application to show it would be absurd.
    expect(mention.getAttribute('target')).toBeNull()

    await user.click(mention)
    expect(onNavigateToNode).toHaveBeenCalledWith('42')
  })
})
