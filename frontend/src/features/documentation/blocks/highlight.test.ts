import { describe, expect, it } from 'vitest'
import {
  codeBlockHtml,
  languageLabel,
  languageOf,
  resolveLanguage,
} from '@/features/documentation/blocks/highlight'

/**
 * Four properties, and the last one is the one worth guarding.
 *
 * The code is coloured by its language; unknown languages stay plain rather than being
 * guessed at; markup in a snippet is displayed instead of run; and the line numbers are
 * not part of the code. That last one is why they live in their own element -- anything
 * inside `<code>` is copied with the snippet and, because the editor renders this same
 * markup, serialized back into the saved document.
 */

function element(html: string): HTMLElement {
  const host = document.createElement('pre')
  host.innerHTML = html

  return host
}

describe('codeBlockHtml', () => {
  it('colours the source according to its language, without altering it', () => {
    const block = element(codeBlockHtml('SELECT id FROM orders', 'sql'))
    const code = block.querySelector('code')!

    expect(code.querySelector('.hljs-keyword')?.textContent).toBe('SELECT')
    expect(code.textContent).toBe('SELECT id FROM orders')
  })

  it('numbers every line, outside the code', () => {
    const block = element(codeBlockHtml('one\ntwo\nthree', 'plaintext'))

    expect(block.querySelector('code')?.textContent).toBe('one\ntwo\nthree')

    // Hidden from assistive technology, excluded from the copied text by CSS, and closed
    // to the caret: a snippet pasted with its line numbers attached does not run, and a
    // gutter somebody can type into is not a gutter.
    const gutter = block.querySelector('.code-gutter')!
    expect(gutter.textContent).toBe('1\n2\n3')
    expect(gutter.getAttribute('aria-hidden')).toBe('true')
    expect(gutter.getAttribute('contenteditable')).toBe('false')
  })

  it('leaves code plain when there is no grammar for its language', () => {
    // Deliberately not guessed: detection on a short snippet is wrong often enough that
    // mis-coloured code is worse than uncoloured code.
    const block = element(codeBlockHtml('PROC DIVIDE.', resolveLanguage('cobol')))
    const code = block.querySelector('code')!

    expect(code.textContent).toBe('PROC DIVIDE.')
    expect(code.querySelector('[class^="hljs-"]')).toBeNull()
  })

  it('displays a snippet containing markup rather than running it', () => {
    for (const language of ['xml', null]) {
      const block = element(codeBlockHtml('<script>alert(1)</script>', language))

      expect(block.querySelector('script')).toBeNull()
      expect(block.querySelector('code')?.textContent).toBe('<script>alert(1)</script>')
    }
  })
})

describe('resolveLanguage', () => {
  it('accepts what people actually type in a fence', () => {
    expect(resolveLanguage('ts')).toBe('typescript')
    expect(resolveLanguage('  RB ')).toBe('ruby')
    // A fence can carry more than a language, and only the first word names the grammar.
    expect(resolveLanguage('js title="server.js"')).toBe('javascript')
    expect(resolveLanguage('cobol')).toBeNull()
    expect(resolveLanguage('')).toBeNull()
  })

  it('reads back off rendered markup, so the editor can re-tokenise a block', () => {
    const block = element(codeBlockHtml('const x = 1', 'typescript'))

    expect(languageOf(block)).toBe('typescript')
    expect(languageOf(element(codeBlockHtml('plain', null)))).toBeNull()
  })
})

describe('languageLabel', () => {
  it('names the grammar, not the alias somebody typed', () => {
    expect(languageLabel(resolveLanguage('py'))).toBe('Python')
    expect(languageLabel(null)).toBe('code')
  })
})
