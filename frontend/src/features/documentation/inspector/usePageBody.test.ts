import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { usePageBody } from '@/features/documentation/inspector/usePageBody'
import type { ContentBlock } from '@/types'

/**
 * usePageBody persistence and state tests.
 *
 * This hook is now responsible only for:
 *   1. Exposing `stored` (Markdown from the DB) as the seeding source for the
 *      Plate/Yjs editor.
 *   2. Debouncing DB writes via `onEditorChange`.
 *   3. Providing `value` (the latest known Markdown) for the reader view.
 *   4. Providing `flush()` for the Done button.
 *
 * It no longer owns a Y.Text or a character-level CRDT binding.
 */

function makeDoc() {
  return new Y.Doc()
}

function makeCollaborativeDocument(doc: Y.Doc) {
  return {
    doc,
    synced: true,
    connected: true,
    editors: [],
    announceEditing: () => {},
  }
}

function block(markdown: string): ContentBlock {
  return { id: '1', blockType: 'MARKDOWN', data: { markdown }, position: 0 }
}

describe('usePageBody', () => {
  it('exposes stored Markdown as the initial value', () => {
    const doc = makeDoc()
    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        blocks: [block('# Hello')],
        saving: false,
        onSave: vi.fn().mockResolvedValue(true),
      }),
    )

    expect(result.current.stored).toBe('# Hello')
    expect(result.current.value).toBe('# Hello')
  })

  it('exposes the collaborative document for the Plate editor', () => {
    const doc = makeDoc()
    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        blocks: [],
        saving: false,
        onSave: vi.fn().mockResolvedValue(true),
      }),
    )

    // The document is passed through so PageEditor can bind usePlateYjsEditor to it.
    expect(result.current.document.doc).toBe(doc)
  })

  it('updates value when the editor reports a change', () => {
    const doc = makeDoc()
    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        blocks: [block('Initial.')],
        saving: false,
        onSave: vi.fn().mockResolvedValue(true),
      }),
    )

    act(() => {
      result.current.onEditorChange('Updated content.')
    })

    expect(result.current.value).toBe('Updated content.')
  })

  it('debounces DB writes on editor change', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn().mockResolvedValue(true)
    const doc = makeDoc()

    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        blocks: [],
        saving: false,
        onSave,
      }),
    )

    act(() => {
      result.current.onEditorChange('Draft.')
      result.current.onEditorChange('Draft more.')
      result.current.onEditorChange('Draft even more.')
    })

    // Not yet — debounce has not fired.
    expect(onSave).not.toHaveBeenCalled()

    // Advance past the debounce timer (1200ms in usePageBody + 600ms snapshot in PageEditor).
    await act(() => vi.advanceTimersByTimeAsync(2000))

    // Only one save call with the final value.
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('Draft even more.')

    vi.useRealTimers()
  })

  it('flush() saves immediately with the latest value', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const doc = makeDoc()

    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        blocks: [block('Old content.')],
        saving: false,
        onSave,
      }),
    )

    act(() => {
      result.current.onEditorChange('New content.')
    })

    const saved = await result.current.flush()

    expect(saved).toBe(true)
    expect(onSave).toHaveBeenCalledWith('New content.')
  })

  it('flush() skips the write when nothing has changed', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const doc = makeDoc()

    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        /*
          A single MARKDOWN block: the only format this editor writes. No
          change means no write — opening and closing the editor for a page
          that is already in this format must be a no-op.
        */
        blocks: [block('Unchanged.')],
        saving: false,
        onSave,
      }),
    )

    // value starts as 'Unchanged.' (from stored), so flush finds nothing to do.
    const saved = await result.current.flush()

    expect(saved).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('resets value when blocks change (node navigation)', () => {
    const doc = makeDoc()
    let blocks = [block('Node A.')]

    const { result, rerender } = renderHook(
      ({ blks }) =>
        usePageBody({
          document: makeCollaborativeDocument(doc),
          blocks: blks,
          saving: false,
          onSave: vi.fn().mockResolvedValue(true),
        }),
      { initialProps: { blks: blocks } },
    )

    expect(result.current.value).toBe('Node A.')

    // Simulate navigating to a different node (blocks change).
    blocks = [block('Node B.')]
    rerender({ blks: blocks })

    expect(result.current.value).toBe('Node B.')
    expect(result.current.stored).toBe('Node B.')
  })

  it('shows a conversion notice for multi-block pages', () => {
    const doc = makeDoc()
    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        blocks: [
          { id: '1', blockType: 'TABLE', data: { columns: ['A'], rows: [['1']] }, position: 0 },
          { id: '2', blockType: 'MARKDOWN', data: { markdown: 'Some text.' }, position: 1 },
        ],
        saving: false,
        onSave: vi.fn().mockResolvedValue(true),
      }),
    )

    expect(result.current.conversionNotice).toBeTruthy()
  })

  it('shows no conversion notice for a single Markdown block', () => {
    const doc = makeDoc()
    const { result } = renderHook(() =>
      usePageBody({
        document: makeCollaborativeDocument(doc),
        blocks: [block('Clean page.')],
        saving: false,
        onSave: vi.fn().mockResolvedValue(true),
      }),
    )

    expect(result.current.conversionNotice).toBeNull()
  })
})
