import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { useCollaborativeDocument } from './useCollaborativeDocument'

const transport = vi.hoisted(() => ({
  create: vi.fn(),
  perform: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@/lib/cable', () => ({
  cable: () => ({ subscriptions: { create: transport.create } }),
  SESSION_ID: 'self',
  subscriptionId: () => 'subscription',
}))

interface Handlers {
  connected(): void
  disconnected(): void
  received(message: { type: string; [key: string]: unknown }): void
}

let handlers: Handlers

function encoded(doc: Y.Doc): string {
  return btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc)))
}

function receive(message: Parameters<Handlers['received']>[0]) {
  act(() => handlers.received(message))
}

function setup() {
  const view = renderHook(() => useCollaborativeDocument('node-1'))
  act(() => handlers.connected())
  return view
}

function completeSync(seq = 0) {
  receive({ type: 'sync', updates: [], seq, syncComplete: true, compactionThreshold: 3 })
}

describe('collaborative transport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    transport.create.mockImplementation((_identifier: object, callbacks: Handlers) => {
      handlers = callbacks
      return transport
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('waits for every sync page before making the editor ready', () => {
    const server = new Y.Doc()
    server.getText('test').insert(0, 'Hello')
    const { result } = setup()
    receive({ type: 'sync', updates: [encoded(server)], seq: 10, syncComplete: false })
    expect(result.current.synced).toBe(false)
    expect(transport.perform).toHaveBeenCalledWith('sync', { afterSeq: 10 })
    server.getText('test').insert(5, ' world')
    receive({ type: 'sync', updates: [encoded(server)], seq: 11, syncComplete: true })
    expect(result.current.synced).toBe(true)
    expect(result.current.doc.getText('test').toString()).toBe('Hello world')
    expect(transport.perform.mock.calls.some(([action]) => action === 'update')).toBe(false)
    server.destroy()
  })

  it('sends durable text immediately but coalesces cursor changes', () => {
    const { result } = setup()
    completeSync()
    act(() => vi.advanceTimersByTime(50))
    transport.perform.mockClear()
    act(() => {
      result.current.doc.getText('test').insert(0, 'a')
      result.current.doc.getText('test').insert(1, 'b')
      for (let i = 0; i < 10; i++) result.current.awareness.setLocalStateField('cursor', { offset: i })
    })
    expect(transport.perform.mock.calls.filter(([action]) => action === 'update')).toHaveLength(2)
    expect(transport.perform.mock.calls.filter(([action]) => action === 'cursor')).toHaveLength(0)
    act(() => vi.advanceTimersByTime(50))
    expect(transport.perform.mock.calls.filter(([action]) => action === 'cursor')).toHaveLength(1)
  })

  it('requests an authoritative checkpoint after own echoes rather than compacting a broadcast watermark', () => {
    const { result } = setup()
    completeSync()
    transport.perform.mockClear()
    const update = encoded(result.current.doc)
    for (const seq of [10, 12, 14, 15]) {
      receive({ type: 'update', sessionId: 'self', update, seq })
    }
    expect(transport.perform.mock.calls.filter(([action]) => action === 'sync')).toHaveLength(1)
    expect(transport.perform.mock.calls.some(([action]) => action === 'compact')).toBe(false)

    const server = new Y.Doc()
    server.getText('test').insert(0, 'Previously missed edit')
    receive({
      type: 'sync', updates: [encoded(server)], seq: 13,
      syncComplete: true, compactionNeeded: true,
    })
    const compact = transport.perform.mock.calls.find(([action]) => action === 'compact')
    expect(compact?.[1].throughSeq).toBe(13)
    const checkpoint = new Y.Doc()
    Y.applyUpdate(checkpoint, Uint8Array.from(atob(compact?.[1].state), (character) => character.charCodeAt(0)))
    expect(checkpoint.getText('test').toString()).toBe('Previously missed edit')
    server.destroy()
    checkpoint.destroy()
  })

  it('does not make passive readers request duplicate checkpoints', () => {
    const { result } = setup()
    completeSync()
    transport.perform.mockClear()
    for (let seq = 1; seq <= 5; seq++) {
      receive({ type: 'update', sessionId: 'peer', update: encoded(result.current.doc), seq })
    }
    expect(transport.perform.mock.calls.some(([action]) => action === 'sync')).toBe(false)
  })

  it('cancels cursor timers on disconnect and waits for sync after reconnect', () => {
    const { result, unmount } = setup()
    completeSync()
    transport.perform.mockClear()
    act(() => handlers.disconnected())
    act(() => vi.advanceTimersByTime(50))
    expect(transport.perform).not.toHaveBeenCalled()
    expect(result.current.synced).toBe(false)
    act(() => handlers.connected())
    expect(result.current.synced).toBe(false)
    completeSync()
    expect(result.current.synced).toBe(true)
    transport.perform.mockClear()
    unmount()
    vi.advanceTimersByTime(100)
    expect(transport.perform).not.toHaveBeenCalled()
    expect(transport.unsubscribe).toHaveBeenCalledOnce()
  })
})
