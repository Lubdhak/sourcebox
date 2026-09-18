import { describe, expect, it } from 'vitest'
import {
  mentionMarkdown,
  mentionNodeId,
} from '@/features/documentation/inspector/mentions'

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

})
