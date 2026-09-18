import { CursorEditor, relativeRangeToSlateRange } from '@slate-yjs/core'
import { Range, Text } from 'slate'
import { createPlatePlugin, PlateLeaf, type PlateLeafProps } from 'platejs/react'
import { collaboratorColor } from '@/features/documentation/collaboration/colors'
import type { Collaborator } from '@/types'

/** The plugin key, and the property name a decoration sets to be rendered by it. Slate
 * merges decoration properties onto the leaves they cover the same way it merges marks,
 * so the two have to agree on a name -- see `CursorLeaf` below for the other half. */
const CURSOR_KEY = 'remoteCursor'

/**
 * What `sendCursorData` puts in Yjs Awareness for this client: enough to draw the other
 * half of a cursor -- the flag and the name on it -- without a lookup. A collaborator's
 * photo does not travel here; a caret is not the header bar, and the colour and the
 * initials it would need already exist on both ends the moment `actor.id` is known.
 */
export interface CursorData {
  name: string
  color: string
  // Yjs's own Awareness state is untyped JSON (`Object<string, any>` in its own
  // declarations) -- this index signature is what lets `cursorDataFor`'s return value
  // satisfy that shape without a cast at the one call site that hands it over.
  [key: string]: unknown
}

export function cursorDataFor(actor: Pick<Collaborator, 'name' | 'colorSeed'>): CursorData {
  return { name: actor.name, color: collaboratorColor(actor.colorSeed) }
}

/**
 * Turns Yjs Awareness's cursor states into Slate decorations, one plugin doing the whole
 * job because a decoration is the only vocabulary Slate has for "colour this range and
 * attach data to it" -- there is no separate channel for a fact about a range that is not
 * a mark on the document.
 *
 * Registered unconditionally by `usePlateYjsEditor` rather than only when peers are
 * present: `CursorEditor.isCursorEditor` returns false and `decorate` returns nothing
 * until `withCursors` has run, so an editor with nobody else in it pays one guard check
 * per node and nothing else.
 *
 * Re-running this on a remote change is not this plugin's job. Slate calls `decorate` on
 * every render of the tree it covers, which is frequent enough for a local keystroke and
 * not at all frequent enough for a peer's cursor moving in a tab that is not being typed
 * in -- see `PageEditor`'s `useRedecorate` call for the other half of that.
 */
export const CursorOverlayPlugin = createPlatePlugin({
  key: CURSOR_KEY,
  node: { isLeaf: true },
  decorate: ({ editor, entry }) => {
    if (!CursorEditor.isCursorEditor(editor)) return []

    const [node, path] = entry
    if (!Text.isText(node)) return []

    const nodeRange = { anchor: { path, offset: 0 }, focus: { path, offset: node.text.length } }
    // Slate's own `Range` carries only `anchor`/`focus`; a decoration is a range with
    // arbitrary extra properties riding along to become leaf props, which is exactly what
    // `CursorLeaf` reads back out.
    const ranges: (Range & Record<string, unknown>)[] = []

    for (const [clientId, state] of Object.entries(CursorEditor.cursorStates(editor))) {
      if (!state.relativeSelection) continue

      const cursorRange = relativeRangeToSlateRange(editor.sharedRoot, editor, state.relativeSelection)
      if (!cursorRange) continue

      const data = state.data as Partial<CursorData> | undefined
      const collapsed = Range.isCollapsed(cursorRange)

      if (collapsed) {
        // A caret is a point, and `Range.intersection` only ever compares spans -- a
        // zero-width range intersected with anything is empty, including the node it is
        // actually sitting in. Placed by hand instead: if the point falls in this node,
        // the decoration *is* the point, with the flag that says "draw a caret here, not
        // a highlight" riding along on the same range clipped by nothing.
        if (!Range.includes(nodeRange, cursorRange.anchor)) continue

        ranges.push({
          anchor: cursorRange.anchor,
          focus: cursorRange.anchor,
          [CURSOR_KEY]: true,
          cursorCaret: true,
          cursorClientId: clientId,
          cursorColor: data?.color,
          cursorName: data?.name,
        })
        continue
      }

      const intersection = Range.intersection(cursorRange, nodeRange)
      if (!intersection) continue

      ranges.push({
        ...intersection,
        [CURSOR_KEY]: true,
        cursorCaret: false,
        cursorClientId: clientId,
        cursorColor: data?.color,
        cursorName: data?.name,
      })
    }

    return ranges
  },
}).withComponent(CursorLeaf)

/**
 * One remote person's presence inside the text: a caret with their name on a flag, or a
 * tinted background over their selection. Both read the same two facts -- whose and where
 * -- off the leaf Slate handed this component, the same way `CodeSyntaxLeaf` reads
 * `leaf.className` for a fact a different plugin put there.
 */
function CursorLeaf(props: PlateLeafProps) {
  const { leaf, children } = props
  const color = typeof leaf.cursorColor === 'string' ? leaf.cursorColor : undefined
  const name = typeof leaf.cursorName === 'string' ? leaf.cursorName : null

  if (leaf.cursorCaret) {
    return (
      <PlateLeaf {...props} className="relative">
        {/*
          The caret itself is one pixel wide and full height, drawn beside the text
          rather than replacing any of it -- a leaf here is otherwise empty (a collapsed
          range covers no characters), so there is nothing to tint and everything to add.
        */}
        <span
          contentEditable={false}
          className="pointer-events-none absolute -top-0.5 bottom-0 left-0 w-0.5"
          style={{ backgroundColor: color }}
        >
          {name ? (
            <span
              className="absolute -top-4 left-0 rounded-t-xs rounded-r-xs px-1 py-0.5 text-[10px] leading-none whitespace-nowrap text-white select-none"
              style={{ backgroundColor: color }}
            >
              {name}
            </span>
          ) : null}
        </span>
        {children}
      </PlateLeaf>
    )
  }

  return (
    <PlateLeaf {...props} style={{ backgroundColor: color ? `color-mix(in oklch, ${color} 35%, transparent)` : undefined }}>
      {children}
    </PlateLeaf>
  )
}
