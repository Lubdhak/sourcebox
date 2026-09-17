import {
  AtSign,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Table,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CODE_LANGUAGES } from '@/features/documentation/blocks/highlight'
import { CollaborativeTextArea } from '@/features/documentation/collaboration/CollaborativeTextArea'
import {
  applyCommand,
  continueList,
  DEFAULT_TABLE,
  SHORTCUTS,
  type CommandId,
  type CommandInput,
  type TableSize,
  type TextEdit,
  type TextSelection,
} from '@/features/documentation/inspector/markdownCommands'
import { applyMention, mentionQueryAt, type MentionQuery } from '@/features/documentation/inspector/mentions'
import { RichEditor, type RichCommand, type RichEditorHandle } from '@/features/documentation/inspector/RichEditor'
import type { PageBody } from '@/features/documentation/inspector/usePageBody'
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
 * Editing happens on the rendered page. Nobody documenting a system should have to know
 * that `##` makes a heading, so the default surface shows headings as headings and the
 * toolbar produces them; Markdown remains what is stored, and is one click away for
 * whoever wants it. That second mode is not a fallback nobody uses -- it is how you paste
 * a document in, fix a table a rich editor is clumsy with, or see exactly what will be
 * saved -- and it is the same shared text underneath, so switching mid-sentence loses
 * nothing.
 *
 * The toolbar is the one thing that has to work in both, and it cannot be written once:
 * formatting a rendered selection and formatting a range of Markdown source are different
 * operations on different things. So each button names an intent, and the two surfaces
 * each say what that intent means -- `RichCommand` through the DOM, `CommandId` through
 * string edits.
 */

export interface MentionCandidate {
  id: string
  title: string
  nodeType?: string
}

const MENTION_DEBOUNCE_MS = 150
const MENTION_LIMIT = 8

interface ToolbarItem {
  /** The Markdown-source command. */
  id: CommandId
  /**
   * The same intent, expressed to the rendered surface.
   *
   * Null for a command that cannot be built until the author has answered something --
   * a table's size, a link's target -- which the toolbar asks for first.
   */
  rich: RichCommand | null
  /** What to ask, for the commands that need an answer. */
  asks?: Asking
  label: string
  icon: typeof Bold
  shortcut?: string
}

const TOOLBAR: ToolbarItem[][] = [
  [
    { id: 'bold', rich: { kind: 'inline', command: 'bold' }, label: 'Bold', icon: Bold, shortcut: '⌘B' },
    { id: 'italic', rich: { kind: 'inline', command: 'italic' }, label: 'Italic', icon: Italic, shortcut: '⌘I' },
    {
      id: 'strike',
      rich: { kind: 'inline', command: 'strikeThrough' },
      label: 'Strikethrough',
      icon: Strikethrough,
    },
    { id: 'code', rich: { kind: 'code' }, label: 'Inline code', icon: Code, shortcut: '⌘E' },
  ],
  [
    { id: 'heading1', rich: { kind: 'block', tag: 'h1' }, label: 'Heading 1', icon: Heading1 },
    { id: 'heading2', rich: { kind: 'block', tag: 'h2' }, label: 'Heading 2', icon: Heading2 },
    { id: 'heading3', rich: { kind: 'block', tag: 'h3' }, label: 'Heading 3', icon: Heading3 },
  ],
  [
    { id: 'bulletList', rich: { kind: 'list', ordered: false }, label: 'Bulleted list', icon: List },
    { id: 'numberedList', rich: { kind: 'list', ordered: true }, label: 'Numbered list', icon: ListOrdered },
    { id: 'checklist', rich: { kind: 'checklist' }, label: 'Task list', icon: ListTodo },
  ],
  [
    { id: 'quote', rich: { kind: 'block', tag: 'blockquote' }, label: 'Quote', icon: Quote },
    { id: 'codeBlock', rich: null, asks: 'code', label: 'Code block', icon: SquareCode },
    { id: 'table', rich: null, asks: 'table', label: 'Table', icon: Table },
    { id: 'divider', rich: { kind: 'divider' }, label: 'Divider', icon: Minus },
  ],
  [
    { id: 'link', rich: null, asks: 'link', label: 'Link', icon: Link2, shortcut: '⌘K' },
    { id: 'clearFormatting', rich: { kind: 'clear' }, label: 'Clear formatting', icon: RemoveFormatting },
  ],
]

type Mode = 'rich' | 'markdown'

/** The three commands that cannot be built until the author has answered something. */
type Asking = 'table' | 'link' | 'code'

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
  const [mention, setMention] = useState<MentionQuery | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const [asking, setAsking] = useState<Asking | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rich = useRef<RichEditorHandle | null>(null)

  // Where the caret should land after a programmatic edit to the source. Applied once the
  // new value has been through the CRDT and back into the DOM, which is why it cannot be
  // set inline.
  const pendingSelection = useRef<TextSelection | null>(null)

  const selection = useCallback((): TextSelection => {
    const element = textareaRef.current

    // With no focus there is no selection, so a toolbar click appends at the end -- the
    // same thing clicking into the empty space below a paragraph would do.
    if (!element) return { start: page.value.length, end: page.value.length }

    return { start: element.selectionStart, end: element.selectionEnd }
  }, [page.value.length])

  const apply = useCallback(
    (edit: TextEdit) => {
      pendingSelection.current = edit.select
      page.applyEdit(edit)
    },
    [page],
  )

  useEffect(() => {
    const target = pendingSelection.current
    if (!target) return

    pendingSelection.current = null
    const element = textareaRef.current
    if (!element) return

    element.focus()
    element.setSelectionRange(target.start, target.end)
  }, [page.value])

  // The caret as it was when the toolbar was clicked.
  //
  // Only the asking commands need this: the form takes the focus, and in Markdown mode a
  // blurred textarea still reports a selection but a later click inside the form would
  // move it. Captured up front, the answer lands where the author was.
  const askedAt = useRef<TextSelection | null>(null)

  const runCommand = useCallback(
    (item: ToolbarItem) => {
      if (item.asks) {
        askedAt.current = selection()
        setAsking((current) => (current === item.asks ? null : item.asks ?? null))
        return
      }

      if (mode === 'rich') {
        if (item.rich) rich.current?.run(item.rich)
        return
      }

      apply(applyCommand(item.id, page.value, selection()))
    },
    [apply, mode, page.value, selection],
  )

  /** Both answers arrive the same way: as the input half of one command. */
  const answer = useCallback(
    (id: CommandId, command: RichCommand, input: CommandInput) => {
      setAsking(null)

      if (mode === 'rich') {
        rich.current?.run(command)
        return
      }

      apply(applyCommand(id, page.value, askedAt.current ?? selection(), input))
    },
    [apply, mode, page.value, selection],
  )

  // In source mode the mention query is re-read from the caret on every keystroke and
  // every click, rather than being tracked as the user types. Tracking it means
  // maintaining a second idea of where the caret is, and the two disagree the moment
  // somebody uses an arrow key -- or the moment a collaborator's edit shifts the text
  // underneath.
  const refreshMention = useCallback(() => {
    const element = textareaRef.current
    if (!element) return

    const found = mentionQueryAt(element.value, element.selectionStart)
    setMention(found)
    if (!found) setHighlighted(0)
  }, [])

  const matches = useMentionCandidates({
    query: mention?.query ?? null,
    candidates,
    onSearch: onSearchMentions,
  })

  const insertMention = useCallback(
    (candidate: MentionCandidate) => {
      const range = mention
      if (!range) return

      setMention(null)

      // The rendered surface replaces the query in the DOM, because a mention there is an
      // anchor rather than link syntax, and the offsets in a rendered tree do not line up
      // with offsets in the source.
      if (mode === 'rich') rich.current?.insertMention(range, candidate)
      else apply(applyMention(range, candidate))
    },
    [apply, mention, mode],
  )

  const startMention = useCallback(() => {
    if (mode === 'rich') {
      rich.current?.startMention()
      return
    }

    const { start, end } = selection()
    const before = start === 0 ? '' : page.value[start - 1]
    // A mention has to begin a word, so the `@` gets a space in front of it when the
    // caret is mid-sentence. Without this the picker would not open on its own insertion.
    const insert = before && !/\s/.test(before) ? ' @' : '@'
    const caret = start + insert.length

    apply({ start, end, insert, select: { start: caret, end: caret } })
  }, [apply, mode, page.value, selection])

  /** Picker navigation, which both surfaces share because the picker is shared. */
  const handlePickerKeys = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (!mention || matches.length === 0) return false

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlighted((current) => (current + step + matches.length) % matches.length)
        return true
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const candidate = matches[highlighted] ?? matches[0]
        if (candidate) insertMention(candidate)
        return true
      }

      return false
    },
    [highlighted, insertMention, matches, mention],
  )

  /**
   * The modifier shortcuts, for both surfaces.
   *
   * Bold and italic are left to the browser in the formatted surface -- a contenteditable
   * already answers Cmd+B correctly, and intercepting it would mean reimplementing what
   * it does to a selection spanning three paragraphs. The two that are ours either way
   * are the link, which has to ask where it goes, and Cmd+Enter to finish.
   */
  const handleShortcuts = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return false

      // Cmd+Enter to finish, the shortcut every comment box has.
      if (event.key === 'Enter') {
        event.preventDefault()
        void page.flush().then(onDone)
        return true
      }

      const command = SHORTCUTS[event.key.toLowerCase()]
      if (!command) return false

      if (command === 'link') {
        event.preventDefault()
        askedAt.current = selection()
        setAsking('link')
        return true
      }

      if (mode === 'rich') return false

      event.preventDefault()
      apply(applyCommand(command, page.value, selection()))

      return true
    },
    [apply, mode, onDone, page, selection],
  )

  const onSourceKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // While the picker is open it owns the navigation keys. Everything else falls
      // through to the textarea, so typing never stops working.
      if (handlePickerKeys(event)) return
      if (handleShortcuts(event)) return

      if (event.key === 'Escape') {
        if (mention) {
          event.preventDefault()
          event.stopPropagation()
          setMention(null)
          return
        }

        // Escape leaves the editor rather than reaching the canvas, which would ascend a
        // level out from under the page being written.
        event.stopPropagation()
        onDone()
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        const element = event.currentTarget
        const edit = continueList(element.value, element.selectionStart)

        if (edit && element.selectionStart === element.selectionEnd) {
          event.preventDefault()
          apply(edit)
        }
      }
    },
    [apply, handlePickerKeys, handleShortcuts, mention, onDone],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur">
        {asking === 'table' ? (
          <TableForm
            onInsert={(size) => answer('table', { kind: 'table', size }, { table: size })}
            onCancel={() => setAsking(null)}
          />
        ) : null}

        {asking === 'link' ? (
          <LinkForm
            onInsert={(href) => answer('link', { kind: 'link', href }, { href })}
            onCancel={() => setAsking(null)}
          />
        ) : null}

        {asking === 'code' ? (
          <LanguageForm
            onInsert={(language) => answer('codeBlock', { kind: 'codeBlock', language }, { language })}
            onCancel={() => setAsking(null)}
          />
        ) : null}

        {TOOLBAR.map((group, index) => (
          <div key={index} className="flex items-center gap-0.5">
            {index > 0 ? <span className="mx-1 h-4 w-px bg-border" aria-hidden /> : null}
            {group.map((item) => (
              <ToolbarButton
                key={item.label}
                item={item}
                disabled={!page.synced}
                pressed={item.asks ? asking === item.asks : undefined}
                onClick={() => runCommand(item)}
              />
            ))}
          </div>
        ))}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          title="Mention a node  @"
          aria-label="Mention a node"
          disabled={!page.synced}
          onMouseDown={(event) => event.preventDefault()}
          onClick={startMention}
          className="grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <AtSign className="size-3.5" />
        </button>

        {/*
          The escape hatch, and it says what it is rather than calling itself a preview:
          the formatted surface is not a preview of anything, it is the document. This
          shows the Markdown that will be saved, and lets somebody edit it directly.
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
      </div>

      <div className="relative min-h-0 flex-1">
        {mode === 'rich' ? (
          <RichEditor
            value={page.value}
            editable={page.synced}
            handle={rich}
            onChangeMarkdown={page.write}
            onMentionQuery={(query) => {
              setMention(query)
              if (!query) setHighlighted(0)
            }}
            onFocus={() => page.announceEditing(true)}
            onBlur={() => page.announceEditing(false)}
            onEscape={() => {
              if (mention) setMention(null)
              else onDone()
            }}
            onPickerKeys={handlePickerKeys}
            onShortcut={handleShortcuts}
          />
        ) : (
          <CollaborativeTextArea
            text={page.text}
            synced={page.synced}
            ariaLabel="Markdown source"
            className="h-full w-full resize-none border-0 bg-transparent px-6 py-4 font-mono text-[13px] leading-relaxed focus-visible:outline-none disabled:opacity-60"
            textareaRef={textareaRef}
            placeholder={PLACEHOLDER}
            onFocus={() => page.announceEditing(true)}
            onBlur={() => page.announceEditing(false)}
            onKeyDown={onSourceKeyDown}
            onSelect={refreshMention}
            onChangeText={refreshMention}
          />
        )}

        {mention ? (
          <MentionPicker
            query={mention.query}
            matches={matches}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onPick={insertMention}
          />
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-6 py-2 text-[11px] text-muted-foreground">
        <span>
          <kbd className="font-sans">@</kbd> to link a node
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

        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => void page.flush().then(onDone)}
        >
          Done
        </Button>
      </footer>
    </div>
  )
}

const PLACEHOLDER = 'Write the documentation for this node…\n\n@ links another node.'

function ToolbarButton({
  item,
  disabled,
  pressed,
  onClick,
}: {
  item: ToolbarItem
  disabled: boolean
  /** Set only for the buttons that open a form, which stays open until answered. */
  pressed?: boolean
  onClick: () => void
}) {
  const Icon = item.icon

  return (
    <button
      type="button"
      // Clicking must not take focus from the editor, or the selection the command is
      // about to format is gone before the handler runs.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={item.shortcut ? `${item.label}  ${item.shortcut}` : item.label}
      aria-label={item.label}
      aria-pressed={pressed}
      className={cn(
        'grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40',
        pressed && 'bg-accent text-foreground',
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

/**
 * How big, asked the way a table is shaped.
 *
 * A grid you drag across rather than two number fields, because the question is "this
 * big" and a shape answers it faster than arithmetic does -- and the caption says the
 * numbers out loud for anyone who wants them, or is using a keyboard, where the fields
 * below are the same answer typed. There is no size guessed on the author's behalf: a
 * two-column table nobody asked for is three edits to fix, and editing a Markdown table's
 * column count by hand means rewriting every row including the divider.
 */
const GRID_COLUMNS = 8
const GRID_ROWS = 6
const MAX_TABLE = 20

function TableForm({
  onInsert,
  onCancel,
}: {
  onInsert: (size: TableSize) => void
  onCancel: () => void
}) {
  // One idea of the size, so the grid, the caption and the fields cannot disagree:
  // pointing at a cell *is* choosing, and the fields are the same choice typed.
  const [size, setSize] = useState<TableSize>(DEFAULT_TABLE)

  return (
    <Form label="Insert table" onCancel={onCancel}>
      <div className="grid w-max gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1rem)` }}>
        {Array.from({ length: GRID_ROWS * GRID_COLUMNS }, (_, index) => {
          const columns = (index % GRID_COLUMNS) + 1
          const rows = Math.floor(index / GRID_COLUMNS) + 1
          const within = columns <= size.columns && rows <= size.rows

          return (
            <button
              key={index}
              type="button"
              aria-label={`${columns} by ${rows}`}
              onMouseEnter={() => setSize({ rows, columns })}
              onFocus={() => setSize({ rows, columns })}
              onClick={() => onInsert({ rows, columns })}
              className={cn(
                'size-4 rounded-[2px] border border-border',
                within ? 'border-brand-500 bg-brand-500/30' : 'hover:border-ring',
              )}
            />
          )
        })}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground" aria-live="polite">
        {size.columns} columns × {size.rows} rows
      </p>

      <div className="mt-2 flex items-end gap-2">
        <Number
          label="Columns"
          value={size.columns}
          onChange={(columns) => setSize((current) => ({ ...current, columns }))}
        />
        <Number
          label="Rows"
          value={size.rows}
          onChange={(rows) => setSize((current) => ({ ...current, rows }))}
        />
        <Button size="sm" onClick={() => onInsert(size)}>
          Insert
        </Button>
      </div>
    </Form>
  )
}

function Number({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        min={1}
        max={MAX_TABLE}
        value={value}
        onChange={(event) => {
          const next = event.target.valueAsNumber

          // A half-typed field reads as NaN, and clamping it to 1 would fight the person
          // typing "12" one digit at a time.
          if (!globalThis.Number.isFinite(next)) return

          onChange(Math.min(MAX_TABLE, Math.max(1, Math.round(next))))
        }}
        className="w-14 rounded-sm border border-input bg-transparent px-1.5 py-1 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      />
    </label>
  )
}

/**
 * Which language the snippet is in.
 *
 * Asked at insertion because that is the only moment the author is thinking about it, and
 * because in the formatted surface there is no fence to type it after. The answer becomes
 * the fence's language in the saved Markdown, which is what the reader's page highlights
 * by -- so skipping the question means a snippet that is monochrome forever.
 *
 * A `select` rather than a free-text field: the set of grammars is fixed and known, and a
 * typo in a fence is invisible until somebody notices the colours never arrived.
 */
function LanguageForm({
  onInsert,
  onCancel,
}: {
  onInsert: (language: string | null) => void
  onCancel: () => void
}) {
  const [language, setLanguage] = useState('plaintext')

  return (
    <Form label="Insert code block" onCancel={onCancel}>
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Language
          <select
            autoFocus
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-48 rounded-sm border border-input bg-transparent px-1.5 py-1 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          >
            {CODE_LANGUAGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => onInsert(language)}>
          Insert
        </Button>
      </div>
    </Form>
  )
}

/** Where the link goes. Asked, rather than inserted as `https://` for someone to find. */
function LinkForm({
  onInsert,
  onCancel,
}: {
  onInsert: (href: string) => void
  onCancel: () => void
}) {
  const [href, setHref] = useState('https://')

  return (
    <Form label="Insert link" onCancel={onCancel}>
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Link to
          <input
            type="url"
            autoFocus
            value={href}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return

              event.preventDefault()
              if (href.trim()) onInsert(href.trim())
            }}
            className="w-64 rounded-sm border border-input bg-transparent px-1.5 py-1 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
        <Button size="sm" disabled={!href.trim()} onClick={() => onInsert(href.trim())}>
          Insert
        </Button>
      </div>
    </Form>
  )
}

/** The shell both forms sit in: anchored under the toolbar, dismissed with Escape. */
function Form({
  label,
  onCancel,
  children,
}: {
  label: string
  onCancel: () => void
  children: React.ReactNode
}) {
  // An id, not the label: `aria-labelledby` splits on whitespace, so "Insert table"
  // would resolve to two ids and name nothing.
  const heading = `page-form-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div
      role="dialog"
      // Labelled by the heading below rather than by an attribute, so what a screen
      // reader announces and what is on screen are the same words.
      aria-labelledby={heading}
      className="absolute left-2 top-full z-20 mt-1 rounded-sm border border-border bg-popover p-3 shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return

        // Stopped here, or Escape would close the editor and then the canvas would
        // ascend a level out from under the page.
        event.stopPropagation()
        onCancel()
      }}
    >
      <p id={heading} className="mb-2 text-xs font-medium">
        {label}
      </p>
      {children}
    </div>
  )
}

function MentionPicker({
  query,
  matches,
  highlighted,
  onHighlight,
  onPick,
}: {
  query: string
  matches: MentionCandidate[]
  highlighted: number
  onHighlight: (index: number) => void
  onPick: (candidate: MentionCandidate) => void
}) {
  return (
    <div
      role="listbox"
      aria-label="Nodes to mention"
      className="absolute inset-x-3 bottom-3 max-h-64 overflow-y-auto rounded-sm border border-border bg-popover p-1 shadow-lg"
    >
      {matches.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {query ? `No node matches “${query}”.` : 'Type to find a node.'}
        </p>
      ) : (
        matches.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHighlight(index)}
            onClick={() => onPick(candidate)}
            className={cn(
              'flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left',
              index === highlighted && 'bg-accent',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-sm">{candidate.title}</span>
            {candidate.nodeType ? (
              <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                {candidate.nodeType}
              </span>
            ) : null}
          </button>
        ))
      )}
    </div>
  )
}

/**
 * The nodes offered for the mention being typed.
 *
 * Two sources, on purpose. Before anything is typed the answer is what is on screen --
 * the level the author is looking at, which is where most links point -- and once they
 * type it becomes a search across the whole space, because the node you want to reference
 * is frequently not the one you can see.
 */
function useMentionCandidates({
  query,
  candidates,
  onSearch,
}: {
  query: string | null
  candidates: MentionCandidate[]
  onSearch: (query: string) => Promise<MentionCandidate[]>
}): MentionCandidate[] {
  const [found, setFound] = useState<MentionCandidate[] | null>(null)
  const search = useRef(onSearch)
  search.current = onSearch

  const trimmed = query?.trim() ?? ''

  useEffect(() => {
    if (trimmed.length < 2) {
      setFound(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      search
        .current(trimmed)
        // A failed lookup falls back to the local list rather than showing an error
        // inside a picker: the author is mid-sentence.
        .then((results) => !cancelled && setFound(results))
        .catch(() => !cancelled && setFound(null))
    }, MENTION_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed])

  return useMemo(() => {
    if (query === null) return []

    const local = candidates.filter((candidate) =>
      candidate.title.toLowerCase().includes(trimmed.toLowerCase()),
    )

    // Local matches first: they are the nodes in view, and they arrive without a round
    // trip, so the list never appears to change under a fast typist's fingers.
    const merged = [...local]
    for (const candidate of found ?? []) {
      if (!merged.some((existing) => existing.id === candidate.id)) merged.push(candidate)
    }

    return merged.slice(0, MENTION_LIMIT)
  }, [candidates, found, query, trimmed])
}
