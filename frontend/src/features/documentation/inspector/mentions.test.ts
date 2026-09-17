import { describe, expect, it } from 'vitest'
import {
  applyMention,
  mentionMarkdown,
  mentionNodeId,
  mentionQueryAt,
} from '@/features/documentation/inspector/mentions'

describe('mentionQueryAt', () => {
  it('finds the mention being typed at the caret', () => {
    expect(mentionQueryAt('See @Pay', 8)).toEqual({ start: 4, end: 8, query: 'Pay' })
  })

  it('allows spaces, because node titles have them', () => {
    expect(mentionQueryAt('@Payment Ser', 12)?.query).toBe('Payment Ser')
  })

  it('ignores an @ inside a word, so email addresses do not open a picker', () => {
    expect(mentionQueryAt('ops@example.com', 15)).toBeNull()
  })

  it('gives up once the text stops looking like a name', () => {
    // Two spaces in a row is ordinary prose that happens to follow an @.
    expect(mentionQueryAt('@ a sentence  continues', 23)).toBeNull()
    expect(mentionQueryAt('@Payments\nnext line', 19)).toBeNull()
  })

  it('does not fire inside a mention that is already written', () => {
    const value = '[@Payments](#node-42)'

    expect(mentionQueryAt(value, value.length)).toBeNull()
  })
})

describe('mention format', () => {
  it('round-trips through a link the sanitizer and Markdown both accept', () => {
    const markdown = mentionMarkdown({ id: '42', title: 'Payment Service' })

    expect(markdown).toBe('[@Payment Service](#node-42)')
    expect(mentionNodeId('#node-42')).toBe('42')
  })

  it('escapes brackets in a title rather than editing somebody’s words', () => {
    expect(mentionMarkdown({ id: '7', title: 'Queue [legacy]' })).toBe('[@Queue \\[legacy\\]](#node-7)')
  })

  it('treats an ordinary link as an ordinary link', () => {
    expect(mentionNodeId('https://example.com')).toBeNull()
    expect(mentionNodeId('#node-abc')).toBeNull()
  })

  it('replaces the typed query and leaves room for the rest of the sentence', () => {
    const value = 'Owned by @Pay'
    const edit = applyMention({ start: 9, end: 13, query: 'Pay' }, { id: '42', title: 'Payments' })
    const next = value.slice(0, edit.start) + edit.insert + value.slice(edit.end)

    expect(next).toBe('Owned by [@Payments](#node-42) ')
    expect(edit.select.start).toBe(next.length)
  })
})
