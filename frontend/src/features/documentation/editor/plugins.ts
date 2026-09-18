import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from '@platejs/basic-nodes/react'
import { CodeBlockRules, getCodeLineEntry, indentCodeLine, outdentCodeLine } from '@platejs/code-block'
import { DndPlugin } from '@platejs/dnd'
import { BlockSelectionPlugin } from '@platejs/selection/react'
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from '@platejs/code-block/react'
import { IndentPlugin } from '@platejs/indent/react'
import { LinkPlugin } from '@platejs/link/react'
import { BulletedListRules, OrderedListRules, TaskListRules, isOrderedList } from '@platejs/list'
import { ListPlugin } from '@platejs/list/react'
import { MarkdownPlugin, defaultRules } from '@platejs/markdown'
import { MentionInputPlugin, MentionPlugin } from '@platejs/mention/react'
import { TableCellHeaderPlugin, TableCellPlugin, TablePlugin, TableRowPlugin } from '@platejs/table/react'
import { KEYS, NodeApi, TrailingBlockPlugin, getPluginTypes } from 'platejs'
import { ParagraphPlugin } from 'platejs/react'
import { createElement } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import remarkGfm from 'remark-gfm'
import { BlockDraggable } from '@/components/ui/block-draggable'
import { BlockList } from '@/components/ui/block-list'
import { BlockSelection } from '@/components/ui/block-selection'
import { DEFAULT_CODE_LANGUAGE, lowlight } from '@/features/documentation/blocks/highlight'
import { MENTION_HREF_PREFIX, mentionNodeId } from '@/features/documentation/inspector/mentions'
import { mentionKeys } from '@/features/documentation/editor/MentionPicker'
import {
  BlockquoteElement,
  CodeBlockElement,
  CodeLineElement,
  CodeSyntaxLeaf,
  H1Element,
  H2Element,
  H3Element,
  HrElement,
  LinkElement,
  MentionElement,
  MentionInputElement,
  ParagraphElement,
  TableCellElement,
  TableElement,
  TableRowElement,
} from '@/features/documentation/editor/nodes'

/**
 * What a documentation page is made of, and how it becomes Markdown.
 *
 * The document model is Plate's, which is to say a tree with rules about what may contain
 * what. That is the whole reason this file replaced a thousand lines of DOM repair: before,
 * the browser decided what Enter did inside a code block and what a deleted table cell
 * left behind, and every one of those decisions had to be detected and undone afterwards.
 * Here a code block holds lines of text because that is what its schema says, and nothing
 * offers to put a table inside a table cell.
 *
 * Markdown stays the only stored form -- no HTML is persisted anywhere, and the reader's
 * page is rendered from the same text by `renderMarkdown`. Conversion goes through remark,
 * so a table is parsed and written by a real GFM implementation rather than by rules of
 * our own. That is what makes the round trip stable, and "the page changed shape when I
 * saved it" a class of bug that cannot happen here.
 *
 * The node set is deliberately the set GFM can hold. Anything else would be a feature that
 * survives until the next save.
 */

/** One indent of code. Two spaces, the nesting every Markdown parser agrees on. */
const CODE_INDENT = '  '

/**
 * GFM, told not to pad table rows out to their widest cell.
 *
 * `| -------- |` for a column whose longest word is eight characters is valid and is not
 * what any document in the database says, so leaving it on would rewrite every table in
 * the space the first time somebody opened its page -- and rewrite it again whenever a
 * cell changed width. Wrapped in a function because the list Plate takes is plugins
 * rather than plugin-and-options pairs.
 */
function unpaddedGfm(this: unknown) {
  const gfm = remarkGfm as unknown as (
    this: unknown,
    options: { tablePipeAlign: boolean },
  ) => undefined

  return gfm.call(this, { tablePipeAlign: false })
}

/** The blocks that can be indented, and so can be list items. Plate's own list. */
const INDENTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock]

export const DOCUMENTATION_PLUGINS = [
  /*
    A line at the end of the document, always.

    A page whose last block is a table or a snippet has nothing after it to put a caret
    in, so it cannot be continued at all -- the author would have to switch to Markdown to
    add a sentence. Plate normalizes one in, which is the same answer the old editor
    reached by appending a paragraph to the DOM, except that here it is part of the
    document and therefore survives everything.

    It costs nothing: an empty paragraph is a blank line in Markdown, and the text is
    trimmed on the way out.
  */
  TrailingBlockPlugin.configure({ options: { type: KEYS.p } }),

  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.withComponent(H1Element),
  H2Plugin.withComponent(H2Element),
  H3Plugin.withComponent(H3Element),
  BlockquotePlugin.withComponent(BlockquoteElement),
  HorizontalRulePlugin.withComponent(HrElement),

  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,

  /*
    Lists, as Plate builds them: an indent level and a marker style on an ordinary block,
    rather than nested `<ul>` elements.

    The input rules are what make typing `- `, `1. ` and `- [ ] ` at the start of a line
    turn into a list, which is how somebody who knows Markdown expects to write one -- and
    Tab and Shift+Tab nest and lift an item without any help from us.
  */
  IndentPlugin.configure({
    inject: { targetPlugins: INDENTABLE },
    options: { offset: 24 },
  }),
  ListPlugin.configure({
    inputRules: [
      BulletedListRules.markdown({ variant: '-' }),
      BulletedListRules.markdown({ variant: '*' }),
      OrderedListRules.markdown({ variant: '.' }),
      OrderedListRules.markdown({ variant: ')' }),
      TaskListRules.markdown({ checked: false }),
      TaskListRules.markdown({ checked: true }),
    ],
    inject: {
      nodeProps: {
        nodeKey: KEYS.listType,
        query: ({ nodeProps }) => {
          const element = nodeProps.element

          return !!element?.listStyleType && !isOrderedList(element)
        },
        transformProps: ({ props }) => ({
          ...props,
          role: 'listitem',
          style: { ...props.style, display: 'list-item' },
        }),
      },
      targetPlugins: INDENTABLE,
    },
    // Plate's own renderer for the marker and the task checkbox, which is also what makes
    // a checkbox in the editor something you can tick rather than something you look at.
    render: { belowNodes: BlockList },
  }),

  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellElement),

  LinkPlugin.withComponent(LinkElement),

  CodeBlockPlugin.configure({
    // ``` at the start of a line opens a block, the way it does in every other editor.
    inputRules: [CodeBlockRules.markdown({ on: 'match' })],
    options: {
      // The colours are Highlight.js's, through lowlight, which is the same tokenizer the
      // reader's page uses -- so a snippet looks identical in both.
      lowlight,
      defaultLanguage: DEFAULT_CODE_LANGUAGE,
    },
    handlers: {
      // Tab is an indent in code, where the plugin leaves it to the browser -- which moves
      // focus out of the editor and takes the caret with it.
      onKeyDown: ({ editor, event }) => {
        if (event.key !== 'Tab') return

        const lines = getCodeLineEntry(editor, {})
        if (!lines) return

        event.preventDefault()

        if (event.shiftKey) outdentCodeLine(editor, lines)
        else indentCodeLine(editor, { ...lines, indentDepth: CODE_INDENT.length })
      },
    },
  }).withComponent(CodeBlockElement),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),

  MentionPlugin.configure({
    // A mention has to begin a word, or every email address in the page would open a
    // picker.
    options: { triggerPreviousCharPattern: /^$|^[\s"']$/ },
  }).withComponent(MentionElement),
  MentionInputPlugin.configure({
    handlers: {
      // While the picker is open it owns the navigation keys; everything else falls
      // through, so typing never stops working.
      onKeyDown: ({ editor, event }) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelMention(editor)

          return
        }

        if (mentionKeys(event.key)) event.preventDefault()
      },
    },
  }).withComponent(MentionInputElement),

  /*
    Selecting a block, and dragging it somewhere else.

    Reordering is the operation a long page needs most and the one Markdown makes worst by
    hand: moving a section means cutting a run of lines whose extent you have to work out
    yourself, and a table or a fenced block is exactly where that goes wrong. A handle in
    the margin turns it into one gesture.

    Block selection is not decoration here -- the handle asks the selection API which
    blocks are picked up, so a drag can move several at once.
  */
  BlockSelectionPlugin.configure(({ editor }) => ({
    options: {
      enableContextMenu: false,
      // A cell and a line of code are parts of a block rather than blocks, and a page
      // whose every code line has its own handle is a page of handles.
      isSelectable: (element) =>
        !getPluginTypes(editor, [KEYS.codeLine, KEYS.td, KEYS.th, KEYS.tr]).includes(element.type),
    },
    render: { belowRootNodes: (props) => createElement(BlockSelection, props as never) },
  })),
  DndPlugin.configure({
    options: { enableScroller: true },
    render: {
      aboveNodes: BlockDraggable,
      aboveSlate: ({ children }) => createElement(DndProvider, { backend: HTML5Backend }, children),
    },
  }),

  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [unpaddedGfm],
      /*
        Written the way the documents already in the database are written.

        This matters more than taste: a page is serialized whenever the editor is open, so
        a serializer whose idea of tidy differs from the stored text rewrites every list
        and every divider on the first save -- a diff nobody made, in every page at once.
      */
      remarkStringifyOptions: {
        bullet: '-',
        listItemIndent: 'one',
        rule: '-',
      },
      rules: {
        /*
          A mention is stored as a link whose target names a node, which is the one piece
          of syntax this application adds to Markdown. Plate's default would write
          `mention:<id>`; the reader's page recognises `#node-<id>`, and a link is what
          every other Markdown tool will make of it.
        */
        mention: {
          serialize: (node) => ({
            children: [{ type: 'text', value: `@${String(node.value ?? '')}` }],
            type: 'link',
            url: `${MENTION_HREF_PREFIX}${String(node.key ?? node.value ?? '')}`,
          }),
        },
        a: {
          ...defaultRules.a,
          deserialize: (mdastNode, deco, options) => {
            const id = mentionNodeId(mdastNode.url ?? '')

            if (id) {
              return {
                children: [{ text: '' }],
                key: id,
                type: KEYS.mention,
                // The label without its `@`, which the chip draws for itself.
                value: mdastText(mdastNode).replace(/^@/, ''),
              } as any
            }

            return defaultRules.a!.deserialize!(mdastNode, deco, options)
          },
        },
      },
    },
  }),
]

/** Escape while typing a mention: the `@query` goes back to being the text it looks like. */
function cancelMention(editor: { api: any; tf: any }): void {
  const entry = editor.api.node({ match: { type: KEYS.mentionInput } })
  if (!entry) return

  const [node, at] = entry

  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at })
    editor.tf.insertText(`@${NodeApi.string(node)}`)
  })
}

function mdastText(node: { children?: unknown[]; value?: string }): string {
  if (typeof node.value === 'string') return node.value

  return (node.children ?? [])
    .map((child) => mdastText(child as { children?: unknown[]; value?: string }))
    .join('')
}
