import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useInspectorTrail } from '@/features/documentation/inspector/useInspectorTrail'

/**
 * The property under test is that back means *one hop*, not "the start of the chain".
 * That is the whole point of a trail: a reader who followed three mentions is reading
 * around a subject, and the way out is the way they came.
 */
describe('useInspectorTrail', () => {
  it('has nowhere to go until a link is followed', () => {
    const { result } = renderHook(() => useInspectorTrail())

    expect(result.current.back).toBeNull()
    expect(result.current.pop()).toBeNull()
  })

  it('walks back one page at a time, in reverse order', () => {
    const { result } = renderHook(() => useInspectorTrail())

    act(() => result.current.follow({ id: '1', title: 'Data Storage' }, '2'))
    expect(result.current.back).toEqual({ id: '1', title: 'Data Storage' })

    act(() => result.current.follow({ id: '2', title: 'Replication' }, '3'))
    // Not "Data Storage": the page just left is the one back leads to.
    expect(result.current.back).toEqual({ id: '2', title: 'Replication' })

    act(() => {
      expect(result.current.pop()).toEqual({ id: '2', title: 'Replication' })
    })
    expect(result.current.back).toEqual({ id: '1', title: 'Data Storage' })

    act(() => {
      expect(result.current.pop()).toEqual({ id: '1', title: 'Data Storage' })
    })
    expect(result.current.back).toBeNull()
  })

  it('names a page from what the panel showed, not from what is on the canvas', () => {
    const { result } = renderHook(() => useInspectorTrail())

    // The canvas has moved off the level this node is on, so the caller can only offer a
    // placeholder. The panel had the real title when the page was open.
    act(() => result.current.remember('1', 'Write-Ahead Log'))
    act(() => result.current.follow({ id: '1', title: 'the previous page' }, '2'))

    expect(result.current.back?.title).toBe('Write-Ahead Log')
  })

  it('ignores a link to the page already open, which is not a hop', () => {
    const { result } = renderHook(() => useInspectorTrail())

    act(() => result.current.follow({ id: '1', title: 'Replication' }, '1'))
    act(() => result.current.follow(null, '2'))

    expect(result.current.back).toBeNull()
  })

  it('starts again when the canvas takes over', () => {
    const { result } = renderHook(() => useInspectorTrail())

    act(() => result.current.follow({ id: '1', title: 'Data Storage' }, '2'))
    act(() => result.current.reset())

    // Selecting a card is a new starting point, so the trail through the reading is over
    // rather than something the next page can step back into.
    expect(result.current.back).toBeNull()
  })
})
