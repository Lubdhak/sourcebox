import { MarkdownPlugin } from '@platejs/markdown'
import { yTextToSlateElement } from '@slate-yjs/core'
import { createSlateEditor, type Value } from 'platejs'
import * as Y from 'yjs'
import { DOCUMENTATION_PLUGINS } from '@/features/documentation/editor/plugins'
import { PLATE_CONTENT_KEY } from '@/features/documentation/collaboration/usePlateYjsEditor'

/**
 * Markdown for whatever `doc`'s shared Plate tree currently holds, read without an
 * interactive editor.
 *
 * A reader has no `PageEditor` mounted -- there is no editor to ask "what does the Y.Doc
 * say right now", and mounting a full, interactive, cursor-tracking one just to answer
 * that once would be a stranger sitting at the desk only to read a memo off it. What is
 * needed is the same conversion `YjsEditor.connect` already does when it loads a shared
 * root into a real editor's `children` (`yTextToSlateElement`), fed once into a throwaway
 * static editor for exactly as long as it takes to serialise it back out to Markdown.
 *
 * Returns null if the shared root is still empty: nobody has seeded this node's Y.Doc yet
 * (see `usePlateYjsEditor`'s seeding), and an empty tree is not the same fact as "nothing
 * has ever been written" -- the caller should keep showing the database's own stored
 * Markdown in that case, not overwrite it with an empty page.
 */
export function deriveMarkdownFromDoc(doc: Y.Doc): string | null {
  const sharedRoot = doc.get(PLATE_CONTENT_KEY, Y.XmlText)
  if (sharedRoot.length === 0) return null

  /*
    `@slate-yjs/core` types this against plain Slate (`Descendant[]`), which does not
    require the `type` field Plate's own richer element type does. The nodes are genuine
    Plate elements at runtime -- `withYjs` hands this exact shape to a real, interactive
    editor's `children` on every connect -- so the cast is only closing a gap between two
    libraries' type vocabularies, not asserting something the data does not already do.
  */
  const { children } = yTextToSlateElement(sharedRoot)
  const editor = createSlateEditor({ plugins: DOCUMENTATION_PLUGINS, value: children as Value })
  return editor.getApi(MarkdownPlugin).markdown.serialize()
}
