import { MarkdownPlugin } from '@platejs/markdown'
import { YjsPlugin } from '@platejs/yjs/react'
import { createPlateEditor } from 'platejs/react'
import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { DOCUMENTATION_PLUGINS } from '@/features/documentation/editor/plugins'
import { PLATE_CONTENT_KEY } from '@/features/documentation/collaboration/usePlateYjsEditor'

/**
 * Yjs CRDT architecture tests.
 *
 * Split into two describe blocks:
 *
 *   1. "Plate serialisation" — pure Plate/Markdown round-trip tests. These do
 *      not need a real Yjs binding and run as long as @platejs/yjs resolves
 *      (even to the no-op stub). They validate the serialisation contract that
 *      the rest of the CRDT architecture depends on.
 *
 *   2. "Yjs collaborative architecture" — tests that require @platejs/yjs to
 *      actually bind the Y.Doc to the Plate editor (concurrent edits, offline
 *      merges, stale-snapshot invariants). These are skipped while the package
 *      stub is in place. Remove the `describe.skip` once `./dev npm install`
 *      installs the real package and the alias in vite.config.ts/vitest.config.ts
 *      is removed.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEditor(doc: Y.Doc) {
  return createPlateEditor({
    plugins: [
      ...DOCUMENTATION_PLUGINS,
      YjsPlugin.configure({ options: { ydoc: doc } }),
    ],
    shouldNormalizeEditor: true,
  })
}

function toMarkdown(editor: ReturnType<typeof makeEditor>): string {
  return editor
    .getApi(MarkdownPlugin)
    .markdown.serialize()
    .replace(/\u200B/g, '')
    .replace(/^\|(?:\s*:?-+:?\s*\|)+$/gm, (row) => row.replace(/-+/g, '---'))
    .trim()
}

function syncAtoB(docA: Y.Doc, docB: Y.Doc) {
  const stateB = Y.encodeStateVector(docB)
  const update = Y.encodeStateAsUpdate(docA, stateB)
  Y.applyUpdate(docB, update, 'remote')
}

function syncBoth(docA: Y.Doc, docB: Y.Doc) {
  syncAtoB(docA, docB)
  syncAtoB(docB, docA)
}

// ---------------------------------------------------------------------------
// 1. Plate serialisation — works with or without the real @platejs/yjs
// ---------------------------------------------------------------------------

describe('Plate serialisation', () => {
  it('round-trips a rich document through Markdown without information loss', () => {
    const doc = new Y.Doc()
    const editor = makeEditor(doc)

    const complex = [
      '## Payments',
      '',
      'Handles **capture** and _refunds_.',
      '',
      '- first item',
      '- second item',
      '',
      '| Setting | Value |',
      '| --- | --- |',
      '| retries | 3 |',
      '',
      '```json',
      '{"key": "value"}',
      '```',
    ].join('\n')

    editor.tf.setValue(editor.getApi(MarkdownPlugin).markdown.deserialize(complex))
    editor.tf.normalize({ force: true })

    const once = toMarkdown(editor)

    editor.tf.setValue(editor.getApi(MarkdownPlugin).markdown.deserialize(once))
    editor.tf.normalize({ force: true })

    const twice = toMarkdown(editor)

    // The serialisation is stable — re-reading and re-writing the same document
    // produces the same Markdown. A page that is only opened (not edited) must
    // not come back rewritten.
    expect(twice).toBe(once)
  })

  it('serialises bold, italic, code, headings, blockquote, table, list, link', () => {
    const doc = new Y.Doc()
    const editor = makeEditor(doc)

    const page = [
      '# Heading',
      '',
      '**bold** _italic_ `code`',
      '',
      '> quote',
      '',
      '- item one',
      '- item two',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'See [link](https://example.com).',
    ].join('\n')

    editor.tf.setValue(editor.getApi(MarkdownPlugin).markdown.deserialize(page))
    editor.tf.normalize({ force: true })

    expect(toMarkdown(editor)).toBe(page)
  })
})

// ---------------------------------------------------------------------------
// 2. Yjs collaborative architecture — requires the real @platejs/yjs package.
//
//    SKIP UNTIL: `./dev npm install` and the alias in vite.config.ts +
//    vitest.config.ts is removed.
// ---------------------------------------------------------------------------

describe.skip('Yjs collaborative architecture (requires @platejs/yjs — remove .skip after install)', () => {
  it('stores structured Plate nodes in the Y.Doc, not Markdown text', () => {
    const doc = new Y.Doc()
    const editor = makeEditor(doc)

    editor.tf.setValue(editor.getApi(MarkdownPlugin).markdown.deserialize('## Hello\n\nWorld.'))
    editor.tf.normalize({ force: true })

    const sharedRoot = doc.get(PLATE_CONTENT_KEY, Y.Array)

    expect(sharedRoot.length).toBeGreaterThan(0)
    expect(sharedRoot.get(0)).not.toBe('## Hello')
  })

  it('preserves concurrent text insertions from two clients', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const editorA = makeEditor(docA)
    const editorB = makeEditor(docB)

    const initial = [{ type: 'p', children: [{ text: 'Hello' }] }]
    editorA.tf.setValue(initial)
    syncAtoB(docA, docB)

    editorA.tf.insertText(' world', { at: { path: [0, 0], offset: 5 } })
    editorB.tf.insertText(' there', { at: { path: [0, 0], offset: 5 } })

    syncBoth(docA, docB)

    const textA = toMarkdown(editorA)
    const textB = toMarkdown(editorB)

    expect(textA).toBe(textB)
    expect(textA).toContain('world')
    expect(textA).toContain('there')
  })

  it('preserves concurrent paragraph insertions from two clients', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const editorA = makeEditor(docA)
    const editorB = makeEditor(docB)

    const initial = [{ type: 'p', children: [{ text: 'Start.' }] }]
    editorA.tf.setValue(initial)
    syncAtoB(docA, docB)

    editorA.tf.insertNodes({ type: 'p', children: [{ text: 'From A.' }] }, { at: [1] })
    editorB.tf.insertNodes({ type: 'p', children: [{ text: 'From B.' }] }, { at: [1] })

    syncBoth(docA, docB)

    const textA = toMarkdown(editorA)
    const textB = toMarkdown(editorB)

    expect(textA).toBe(textB)
    expect(textA).toContain('From A.')
    expect(textA).toContain('From B.')
  })

  it('preserves concurrent formatting and text edits', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const editorA = makeEditor(docA)
    const editorB = makeEditor(docB)

    const initial = [{ type: 'p', children: [{ text: 'Hello world' }] }]
    editorA.tf.setValue(initial)
    syncAtoB(docA, docB)

    editorA.tf.addMarks(
      { bold: true },
      { at: { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 5 } } },
    )
    editorB.tf.insertText(' again', { at: { path: [0, 0], offset: 11 } })

    syncBoth(docA, docB)

    const textA = toMarkdown(editorA)
    const textB = toMarkdown(editorB)

    expect(textA).toBe(textB)
    expect(textA).toContain('**Hello**')
    expect(textA).toContain('again')
  })

  it('does not overwrite newer Yjs state with a stale Markdown snapshot', () => {
    const docA = new Y.Doc()
    const editorA = makeEditor(docA)

    editorA.tf.setValue(editorA.getApi(MarkdownPlugin).markdown.deserialize('Original content.'))
    editorA.tf.normalize({ force: true })

    const staleSnapshot = toMarkdown(editorA)

    editorA.tf.insertNodes(
      { type: 'p', children: [{ text: 'New paragraph added after snapshot.' }] },
      { at: [1] },
    )

    const docFresh = new Y.Doc()
    const editorFresh = makeEditor(docFresh)
    editorFresh.tf.setValue(editorFresh.getApi(MarkdownPlugin).markdown.deserialize(staleSnapshot))
    editorFresh.tf.normalize({ force: true })

    const liveState = docA.get(PLATE_CONTENT_KEY, Y.Array)
    const freshState = docFresh.get(PLATE_CONTENT_KEY, Y.Array)

    expect(toMarkdown(editorA)).toContain('New paragraph added after snapshot.')
    expect(toMarkdown(editorFresh)).not.toContain('New paragraph added after snapshot.')
    expect(liveState.length).toBeGreaterThan(freshState.length)
  })

  it('merges offline edits when a disconnected client reconnects', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const editorA = makeEditor(docA)
    const editorB = makeEditor(docB)

    editorA.tf.setValue([{ type: 'p', children: [{ text: 'Shared start.' }] }])
    syncAtoB(docA, docB)

    editorB.tf.insertNodes(
      { type: 'p', children: [{ text: 'Offline edit by B.' }] },
      { at: [1] },
    )
    editorA.tf.insertNodes(
      { type: 'p', children: [{ text: 'Edit by A while B was away.' }] },
      { at: [1] },
    )

    syncBoth(docA, docB)

    const textA = toMarkdown(editorA)
    const textB = toMarkdown(editorB)

    expect(textA).toBe(textB)
    expect(textA).toContain('Offline edit by B.')
    expect(textA).toContain('Edit by A while B was away.')
  })
})
