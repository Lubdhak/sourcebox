import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { MarkdownPlugin } from '@platejs/markdown'
import { KEYS } from 'platejs'
import { Plate, PlateContent, useEditorRef } from 'platejs/react'
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
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { insertTable } from '@platejs/table'
import { toggleCodeBlock } from '@platejs/code-block'
import { usePlateYjsEditor } from '@/features/documentation/collaboration/usePlateYjsEditor'
import { DEFAULT_CODE_LANGUAGE } from '@/features/documentation/blocks/highlight'
import { MentionSourceProvider } from '@/features/documentation/editor/MentionSource'
import type { MentionCandidate } from '@/features/documentation/editor/MentionPicker'
import {
  continueLine,
  indentLines,
  type TextEdit,
} from '@/features/documentation/editor/sourceCommands'
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
 * ### Collaborative architecture
 *
 * The canonical collaborative document is:
 *
 *   Y.Doc  →  @platejs/yjs  →  Plate / Slate model  →  React UI
 *
 * Markdown is a derived representation:
 *
 *   Plate document  →  MarkdownPlugin.serialize()  →  Markdown snapshot  →  DB
 *
 * The editor is created by `usePlateYjsEditor`, which:
 *   - Attaches the Y.Doc to the Plate editor via YjsPlugin.
 *   - Seeds the Y.Doc from stored Markdown when the collaborative document is empty.
 *
 * Remote Yjs updates arrive as precise Slate operations (not a full `setValue`), so
 * the cursor survives a collaborator's keystrokes. Local Plate operations become Yjs
 * operations through the binding — no Markdown serialisation in the hot path.
 *
 * ### Markdown mode
 *
 * The "Markdown" toggle shows the current Plate state as raw text. In this mode:
 *   - The textarea is initialised from `editor.serialize()` when the mode is entered.
 *   - Changes to the textarea are applied to the Plate editor (via `setValue + Yjs`),
 *     which propagates them to collaborators through the Y.Doc.
 *   - Keyboard shortcuts (Tab, Enter continuation) apply to the local string.
 *
 * Markdown mode is NOT a second collaborative surface. Two people editing Markdown
 * simultaneously is not supported: the rich editor is the primary collaborative surface.
 */

export type { MentionCandidate }

type Mode = 'rich' | 'markdown'

/**
 * How often the Plate `onChange` handler serialises the document to Markdown.
 *
 * This produces the snapshot that usePageBody debounces into a DB write. Keep
 * it low enough that a crash loses little work; the DB write is debounced
 * separately in usePageBody.
 */
const SNAPSHOT_DEBOUNCE_MS = 600

export function PageEditor({
  page,
  candidates,
  onSearchMentions,
  onDone,
}: {
  page: PageBody
  candidates: MentionCandidate[]
  onSearchMentions: (query: string) => Promise<MentionCandidate[]>
  onDone: () => void
}) {
  const [mode, setMode] = useState<Mode>('rich')
  const [markdownText, setMarkdownText] = useState('')

  /*
    The Plate editor, bound to the collaborative Y.Doc via @platejs/yjs.

    usePlateYjsEditor handles:
      - Adding YjsPlugin to the plugin set.
      - Seeding the Y.Doc from page.stored when it is empty.
      - The election mechanism that prevents double-seeding on concurrent joins.

    The editor instance is stable for the lifetime of this component; recreating
    it would disconnect the Yjs binding and lose in-flight operations.
  */
  const editor = usePlateYjsEditor({
    document: page.document,
    stored: page.stored,
  })

  /*
    Snapshot timer: fires when the Plate editor changes (via the <Plate onChange>
    prop). Serialises the document to Markdown and reports it to usePageBody for
    debounced DB persistence. Only runs when the Plate editor is the authoritative
    surface (both in rich mode and during Markdown mode apply).
  */
  const snapshotTimer = useRef<number | null>(null)

  const scheduleSnapshot = useCallback(() => {
    if (snapshotTimer.current !== null) window.clearTimeout(snapshotTimer.current)
    snapshotTimer.current = window.setTimeout(() => {
      snapshotTimer.current = null
      const markdown = tidy(editor.getApi(MarkdownPlugin).markdown.serialize())
      page.onEditorChange(markdown)
    }, SNAPSHOT_DEBOUNCE_MS)
  }, [editor, page])

  /*
    Markdown apply timer: when the user types in the textarea, we debounce
    applying the Markdown text to the Plate editor. This propagates via the Yjs
    binding so collaborators in rich mode see the changes in near-real-time.

    Keeping this separate from the snapshot timer lets both fire independently:
    apply happens on textarea change, snapshot happens on Plate editor change
    (which is triggered by the apply).
  */
  const applyTimer = useRef<number | null>(null)

  const applyMarkdownToEditor = useCallback(
    (text: string) => {
      if (applyTimer.current !== null) window.clearTimeout(applyTimer.current)
      applyTimer.current = window.setTimeout(() => {
        applyTimer.current = null
        const value = editor.getApi(MarkdownPlugin).markdown.deserialize(text)
        editor.tf.setValue(value)
        editor.tf.normalize({ force: true })
        // onEditorChange is called via scheduleSnapshot (triggered by setValue → Plate onChange).
        // Calling it here too keeps page.value and flush() current without waiting for
        // the snapshot timer.
        page.onEditorChange(text)
      }, SNAPSHOT_DEBOUNCE_MS)
    },
    [editor, page],
  )

  /*
    Enter Markdown mode: snapshot the current Plate state and show it in the
    textarea. The Plate editor is still active in the background (the <Plate>
    wrapper stays mounted), so Yjs keeps receiving remote updates — they just
    aren't reflected in the textarea until the user exits Markdown mode.
  */
  const enterMarkdownMode = useCallback(() => {
    const snapshot = tidy(editor.getApi(MarkdownPlugin).markdown.serialize())
    setMarkdownText(snapshot)
    setMode('markdown')
  }, [editor])

  /*
    Exit Markdown mode: switch the UI back to rich. The Plate editor already has
    the latest content (kept current by the debounced apply on every textarea
    change), so no extra setValue call is needed here.
  */
  const exitMarkdownMode = useCallback(() => {
    // Cancel any pending apply — the user is done editing Markdown.
    if (applyTimer.current !== null) {
      window.clearTimeout(applyTimer.current)
      applyTimer.current = null
      // Apply synchronously with the current text so nothing is lost.
      const value = editor.getApi(MarkdownPlugin).markdown.deserialize(markdownText)
      editor.tf.setValue(value)
      editor.tf.normalize({ force: true })
      page.onEditorChange(markdownText)
    }
    setMode('rich')
  }, [editor, markdownText, page])

  const handleModeToggle = useCallback(() => {
    if (mode === 'rich') enterMarkdownMode()
    else exitMarkdownMode()
  }, [enterMarkdownMode, exitMarkdownMode, mode])

  const handleDone = useCallback(() => {
    // If there is a pending Markdown apply, flush it synchronously first.
    if (mode === 'markdown' && applyTimer.current !== null) {
      window.clearTimeout(applyTimer.current)
      applyTimer.current = null
      const value = editor.getApi(MarkdownPlugin).markdown.deserialize(markdownText)
      editor.tf.setValue(value)
      editor.tf.normalize({ force: true })
      page.onEditorChange(markdownText)
    }
    void page.flush().then(onDone)
  }, [editor, markdownText, mode, onDone, page])

  /*
    Caret management for the Markdown textarea.

    A controlled textarea puts the cursor at the end on every re-render. When we
    apply a Tab indent or an Enter continuation, we compute where the cursor
    should be afterwards and restore it in a layout effect (before the browser
    paints, so there is no flicker).
  */
  const markdownRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingCaret = useRef<{ start: number; end: number } | null>(null)

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !markdownRef.current) return
    markdownRef.current.setSelectionRange(pendingCaret.current.start, pendingCaret.current.end)
    pendingCaret.current = null
  }, [markdownText])

  /*
    Apply a TextEdit to markdownText and schedule a caret restore.

    TextEdit = { start, end, insert, select } — replace slice [start, end)
    with insert, then put the caret at select.
  */
  const applyMarkdownEdit = useCallback(
    (edit: TextEdit) => {
      const next = markdownText.slice(0, edit.start) + edit.insert + markdownText.slice(edit.end)
      pendingCaret.current = edit.select
      setMarkdownText(next)
      applyMarkdownToEditor(next)
    },
    [applyMarkdownToEditor, markdownText],
  )

  const onSourceKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const element = event.currentTarget

      if (event.key === 'Escape') {
        event.stopPropagation()
        onDone()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        exitMarkdownMode()
        void page.flush().then(onDone)
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        applyMarkdownEdit(
          indentLines(
            markdownText,
            { start: element.selectionStart, end: element.selectionEnd },
            event.shiftKey,
          ),
        )
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        const edit = continueLine(markdownText, element.selectionStart)
        if (edit && element.selectionStart === element.selectionEnd) {
          event.preventDefault()
          applyMarkdownEdit(edit)
        }
      }
    },
    [applyMarkdownEdit, exitMarkdownMode, markdownText, onDone, page],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Radix's tooltip context, which Plate's controls expect.
      */}
      <TooltipPrimitive.Provider delayDuration={400}>
        <Plate editor={editor} onChange={scheduleSnapshot}>
          <MentionSourceProvider candidates={candidates} onSearchMentions={onSearchMentions}>
            <FixedToolbar className="justify-start gap-0.5 border-b border-border px-2 py-1.5">
              <PageToolbar disabled={!page.synced || mode === 'markdown'} />

              {/*
                The escape hatch: shows the Markdown that will be saved, and lets
                somebody edit it directly.
              */}
              <button
                type="button"
                onClick={handleModeToggle}
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
                  */}
                  <FloatingToolbar>
                    <SelectionToolbar />
                  </FloatingToolbar>

                  <PlateContent
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
                <textarea
                  ref={markdownRef}
                  value={markdownText}
                  onChange={(event) => {
                    const next = event.target.value
                    setMarkdownText(next)
                    applyMarkdownToEditor(next)
                  }}
                  disabled={!page.synced}
                  aria-label="Markdown source"
                  className="h-full w-full resize-none border-0 bg-transparent px-6 py-4 font-mono text-[13px] leading-relaxed focus-visible:outline-none disabled:opacity-60"
                  placeholder={page.synced ? PLACEHOLDER : 'Loading…'}
                  onFocus={() => page.announceEditing(true)}
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

        <Button size="sm" variant="outline" className="ml-auto" onClick={handleDone}>
          Done
        </Button>
      </footer>
    </div>
  )
}

const PLACEHOLDER = 'Write the documentation for this node…'

/**
 * Normalise the Markdown that Plate's serialiser produces.
 *
 * These two adjustments keep the stored form stable so that merely opening
 * and reading a page does not trigger a write:
 *
 *   \u200B  — a zero-width space used by Plate for empty paragraphs in the
 *              document model; it must not reach the database.
 *
 *   | - |   — remark writes the shortest valid table divider; every document
 *              already in the database uses `| --- |`, so we normalise to that
 *              form to avoid rewriting every table on the first open.
 */
function tidy(markdown: string): string {
  return markdown
    .replace(/\u200B/g, '')
    .replace(/^\|(?:\s*:?-+:?\s*\|)+$/gm, (row) => row.replace(/-+/g, '---'))
    .trim()
}

/**
 * What the floating toolbar offers: the things you do to words you have just selected.
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
        <TableToolbarButton />
      </ToolbarGroup>
    </div>
  )
}
