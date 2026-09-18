import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { MarkdownPlugin } from '@platejs/markdown'
import { KEYS } from 'platejs'
import { Plate, PlateContent, useEditorRef, usePlateEditor } from 'platejs/react'
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Quote,
  SquareCode,
  Table as TableIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { insertTable } from '@platejs/table'
import { toggleCodeBlock } from '@platejs/code-block'
import { CollaborativeTextArea } from '@/features/documentation/collaboration/CollaborativeTextArea'
import { DEFAULT_CODE_LANGUAGE } from '@/features/documentation/blocks/highlight'
import { MentionSourceProvider } from '@/features/documentation/editor/MentionSource'
import type { MentionCandidate } from '@/features/documentation/editor/MentionPicker'
import { DOCUMENTATION_PLUGINS } from '@/features/documentation/editor/plugins'
import { continueLine, indentLines } from '@/features/documentation/editor/sourceCommands'
import type { PageBody } from '@/features/documentation/inspector/usePageBody'
import { FixedToolbar } from '@/components/ui/fixed-toolbar'
import { FloatingToolbar } from '@/components/ui/floating-toolbar'
import { LinkToolbarButton } from '@/components/ui/link-toolbar-button'
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
  TodoListToolbarButton,
} from '@/components/ui/list-toolbar-button'
import { MarkToolbarButton } from '@/components/ui/mark-toolbar-button'
import { TableToolbarButton } from '@/components/ui/table-toolbar-button'
import { ToolbarButton, ToolbarGroup } from '@/components/ui/toolbar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The page editor: formatted text, a toolbar, and `@` to link another node.
 *
 * There is no block type here and no "add block" -- a node's documentation is a document,
 * and the storage being a list of typed payloads is the storage's business. What that
 * buys is the thing every documentation tool gets right and a block form gets wrong: you
 * put the caret where the words go and write, instead of first answering what kind of
 * thing you are about to write.
 *
 * The editor is Plate, which is to say a real document model. Everything that used to be
 * a bug here -- Enter in a code block, a table inside a table cell, a caret that vanished
 * when a collaborator typed, Tab leaving the editor -- was the same bug: `contenteditable`
 * let the browser decide what a keystroke meant, and we read the wreckage afterwards.
 * A schema decides now, and the toolbar is Plate's own.
 *
 * Markdown remains what is stored, and is one click away for whoever wants it. That second
 * mode is not a fallback nobody uses -- it is how you paste a document in, fix something
 * by hand, or see exactly what will be saved -- and it is the same shared text underneath,
 * so switching mid-sentence loses nothing.
 */

export type { MentionCandidate }

type Mode = 'rich' | 'markdown'

export function PageEditor({
  page,
  candidates,
  onSearchMentions,
  onDone,
}: {
  page: PageBody
  /** Shown before anything is typed after `@`: the nodes on screen, which is usually enough. */
  candidates: MentionCandidate[]
  onSearchMentions: (query: string) => Promise<MentionCandidate[]>
  onDone: () => void
}) {
  const [mode, setMode] = useState<Mode>('rich')

  /*
    The seam between a document and the text it is stored as.

    The shared document is Markdown in a `Y.Text`, which is what lets the Markdown surface
    be the same document rather than a copy of it, and what keeps the stored form the only
    form. So the editor parses that text once and writes it back on every change, and
    `settled` is the last text either side agreed on -- the test for "this change came from
    somebody else" and the thing that stops an echo from re-parsing the document under the
    caret.
  */
  const settled = useRef(page.value)

  const editor = usePlateEditor({
    plugins: DOCUMENTATION_PLUGINS,
    value: (instance) => instance.getApi(MarkdownPlugin).markdown.deserialize(page.value),
    // A parsed document has not been through the editor's own rules yet, and one of those
    // rules is the line at the end. Without this, a page whose last block is a table has
    // nothing after it to put a caret in until something else happens to normalize.
    shouldNormalizeEditor: true,
  })

  const write = useCallback(() => {
    const markdown = editor
      .getApi(MarkdownPlugin)
      .markdown.serialize()
      // An empty paragraph is written as a zero-width space, which is how a document
      // model keeps a line nobody has typed in yet. It is not something to store: it
      // would travel into the database, into the reader's page, and into the next
      // serialization, and `trim` does not consider it whitespace.
      .replace(/\u200B/g, '')
      // A table's divider row, written with three dashes a column the way every document
      // already in the database writes it. remark writes the narrowest row that parses --
      // `| - | - |` -- and the alternative is padding each column to its widest cell,
      // which changes again every time a cell does. Either one would rewrite every table
      // in the space the first time somebody opened its page.
      .replace(/^\|(?:\s*:?-+:?\s*\|)+$/gm, (row) => row.replace(/-+/g, '---'))
      .trim()

    if (markdown === settled.current) return

    settled.current = markdown
    page.write(markdown)
  }, [editor, page])

  useEffect(() => {
    if (page.value === settled.current) return

    settled.current = page.value
    editor.tf.setValue(editor.getApi(MarkdownPlugin).markdown.deserialize(page.value))
    // The same rules as at creation: a document that arrives from somebody else also has
    // to end somewhere a caret can go.
    editor.tf.normalize({ force: true })
  }, [editor, page.value])

  const selection = useCallback(
    (element: HTMLTextAreaElement) => ({ start: element.selectionStart, end: element.selectionEnd }),
    [],
  )

  const onSourceKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const element = event.currentTarget

      if (event.key === 'Escape') {
        // Stopped here rather than reaching the canvas, which would ascend a level out
        // from under the page being written.
        event.stopPropagation()
        onDone()

        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void page.flush().then(onDone)

        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        page.applyEdit(indentLines(element.value, selection(element), event.shiftKey))

        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        const edit = continueLine(element.value, element.selectionStart)

        if (edit && element.selectionStart === element.selectionEnd) {
          event.preventDefault()
          page.applyEdit(edit)
        }
      }
    },
    [onDone, page, selection],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Radix's tooltip context, which Plate's controls expect. This project's own tooltip
        is built on Base UI, so the editor keeps its own provider rather than the two
        being made to agree.
      */}
      <TooltipPrimitive.Provider delayDuration={400}>
        <Plate editor={editor} onChange={write}>
        <MentionSourceProvider candidates={candidates} onSearchMentions={onSearchMentions}>
          <FixedToolbar className="justify-start gap-0.5 border-b border-border px-2 py-1.5">
            <PageToolbar disabled={!page.synced || mode === 'markdown'} />

            {/*
              The escape hatch, and it says what it is rather than calling itself a
              preview: the formatted surface is not a preview of anything, it is the
              document. This shows the Markdown that will be saved, and lets somebody edit
              it directly.
            */}
            <button
              type="button"
              onClick={() => setMode((current) => (current === 'rich' ? 'markdown' : 'rich'))}
              aria-pressed={mode === 'markdown'}
              className={cn(
                'ml-auto flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground',
                mode === 'markdown' && 'bg-accent text-foreground',
              )}
            >
              <SquareCode className="size-3.5" />
              Markdown
            </button>
          </FixedToolbar>

          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {mode === 'rich' ? (
              <>
                {/*
                  The same controls again, where the hands already are.

                  A toolbar at the top of the panel is a long way from a word in the middle
                  of a page, and the formatting somebody reaches for is nearly always for
                  the words they have just selected. Plate positions this against the
                  selection and hides it when there is none.
                */}
                <FloatingToolbar>
                  <SelectionToolbar />
                </FloatingToolbar>

                <PlateContent
                  // Styled by exactly the rules a reader sees, because the stored form is
                  // the same Markdown. Editing something that looks different from the
                  // published result is the failure mode this surface exists to avoid.
                  //
                  // The left padding is room for the drag handle, which sits in the margin
                  // so that it never moves the text it belongs to.
                  className="documentation-markdown min-h-full py-4 pl-12 pr-6 text-sm leading-relaxed focus-visible:outline-none"
                  readOnly={!page.synced}
                  aria-label="Page content"
                  placeholder={PLACEHOLDER}
                  onFocus={() => page.announceEditing(true)}
                  onBlur={() => page.announceEditing(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      onDone()

                      return
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault()
                      void page.flush().then(onDone)
                    }
                  }}
                />
              </>
            ) : (
              <CollaborativeTextArea
                text={page.text}
                synced={page.synced}
                ariaLabel="Markdown source"
                className="h-full w-full resize-none border-0 bg-transparent px-6 py-4 font-mono text-[13px] leading-relaxed focus-visible:outline-none disabled:opacity-60"
                placeholder={PLACEHOLDER}
                onFocus={() => page.announceEditing(true)}
                onBlur={() => page.announceEditing(false)}
                onKeyDown={onSourceKeyDown}
              />
            )}
          </div>
        </MentionSourceProvider>
        </Plate>
      </TooltipPrimitive.Provider>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-6 py-2 text-[11px] text-muted-foreground">
        <span>
          <kbd className="font-sans">@</kbd> to link a node
        </span>

        <span>
          <kbd className="font-sans">Esc</kbd> to finish
        </span>

        <span>
          {page.editorNames.length > 0
            ? `${page.editorNames.join(', ')} ${page.editorNames.length === 1 ? 'is' : 'are'} in here too`
            : page.synced
              ? page.saving
                ? 'Saving…'
                : 'Saved as you type'
              : 'Connecting…'}
        </span>

        {page.conversionNotice ? <span className="text-amber-600">{page.conversionNotice}</span> : null}

        <Button size="sm" variant="outline" className="ml-auto" onClick={() => void page.flush().then(onDone)}>
          Done
        </Button>
      </footer>
    </div>
  )
}

const PLACEHOLDER = 'Write the documentation for this node…'

/**
 * What the floating toolbar offers: the things you do to words you have just selected.
 *
 * Deliberately shorter than the bar at the top. A selection is a phrase, and the useful
 * answers to a phrase are emphasis, a link, and "make this a heading" -- not "insert a
 * table here", which is about a place rather than about the words.
 */
function SelectionToolbar() {
  const editor = useEditorRef()

  return (
    <>
      <ToolbarGroup>
        <MarkToolbarButton nodeType={KEYS.bold} aria-label="Bold" tooltip="Bold  ⌘B">
          <span className="font-bold">B</span>
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.italic} aria-label="Italic" tooltip="Italic  ⌘I">
          <span className="italic">I</span>
        </MarkToolbarButton>
        <MarkToolbarButton
          nodeType={KEYS.strikethrough}
          aria-label="Strikethrough"
          tooltip="Strikethrough"
        >
          <span className="line-through">S</span>
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.code} aria-label="Inline code" tooltip="Inline code  ⌘E">
          <Code />
        </MarkToolbarButton>
        <LinkToolbarButton />
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton aria-label="Heading 2" tooltip="Heading 2" onClick={() => editor.tf.toggleBlock(KEYS.h2)}>
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton aria-label="Heading 3" tooltip="Heading 3" onClick={() => editor.tf.toggleBlock(KEYS.h3)}>
          <Heading3 />
        </ToolbarButton>
        <ToolbarButton aria-label="Quote" tooltip="Quote" onClick={() => editor.tf.toggleBlock(KEYS.blockquote)}>
          <Quote />
        </ToolbarButton>
      </ToolbarGroup>
    </>
  )
}

/**
 * The toolbar, assembled from Plate's own controls.
 *
 * Only the ones this document set has nodes for. Plate ships a much larger bar -- AI,
 * comments, media, colours, alignment -- and every one of those is a button that would
 * either do nothing here or write something Markdown cannot hold, which is the same thing
 * as losing it on the next save.
 *
 * The block buttons are Plate's `ToolbarButton` driven by its transforms rather than its
 * "turn into" menu, because that menu is generated from a plugin list we deliberately do
 * not have.
 */
function PageToolbar({ disabled }: { disabled: boolean }) {
  const editor = useEditorRef()

  return (
    <div className={cn('flex flex-wrap items-center gap-0.5', disabled && 'pointer-events-none opacity-40')}>
      <ToolbarGroup>
        <MarkToolbarButton nodeType={KEYS.bold} aria-label="Bold" tooltip="Bold  ⌘B">
          <span className="font-bold">B</span>
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.italic} aria-label="Italic" tooltip="Italic  ⌘I">
          <span className="italic">I</span>
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.strikethrough} aria-label="Strikethrough" tooltip="Strikethrough">
          <span className="line-through">S</span>
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.code} aria-label="Inline code" tooltip="Inline code  ⌘E">
          <Code />
        </MarkToolbarButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton aria-label="Heading 1" tooltip="Heading 1" onClick={() => editor.tf.toggleBlock(KEYS.h1)}>
          <Heading1 />
        </ToolbarButton>
        <ToolbarButton aria-label="Heading 2" tooltip="Heading 2" onClick={() => editor.tf.toggleBlock(KEYS.h2)}>
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton aria-label="Heading 3" tooltip="Heading 3" onClick={() => editor.tf.toggleBlock(KEYS.h3)}>
          <Heading3 />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <BulletedListToolbarButton />
        <NumberedListToolbarButton />
        <TodoListToolbarButton />
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton aria-label="Quote" tooltip="Quote" onClick={() => editor.tf.toggleBlock(KEYS.blockquote)}>
          <Quote />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Code block"
          tooltip="Code block"
          onClick={() => {
            toggleCodeBlock(editor)
            // A snippet arrives as JSON rather than as a question, and the picker in the
            // block's corner is how it becomes something else.
            editor.tf.setNodes(
              { lang: DEFAULT_CODE_LANGUAGE },
              { match: (node) => node.type === KEYS.codeBlock },
            )
          }}
        >
          <SquareCode />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Table"
          tooltip="Table"
          onClick={() => insertTable(editor, { colCount: 3, rowCount: 3 }, { select: true })}
        >
          <TableIcon />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Divider"
          tooltip="Divider"
          onClick={() => editor.tf.insertNodes({ children: [{ text: '' }], type: KEYS.hr })}
        >
          <Minus />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <LinkToolbarButton />
        {/* Plate's own table menu: rows and columns in and out, which is what a table needs. */}
        <TableToolbarButton />
      </ToolbarGroup>
    </div>
  )
}
