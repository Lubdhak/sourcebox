import { ArrowLeft, ArrowRight, ChevronDown, Link2, Pencil, Trash2, X } from 'lucide-react'
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MarkdownBlock } from '@/features/documentation/blocks/MarkdownBlock'
import {
  useCollaborativeDocument,
  type RemoteAuthor,
} from '@/features/documentation/collaboration/useCollaborativeDocument'
import { PersonAvatar } from '@/features/documentation/collaboration/PersonAvatar'
import {
  DISCONNECTED_HINT,
  DISCONNECTED_LABEL,
  DisconnectedIcon,
  isDisconnected,
} from '@/features/documentation/disconnected'
import * as api from '@/features/documentation/graphql'
import type { MentionCandidate } from '@/features/documentation/inspector/PageEditor'
import { useNodeDetail } from '@/features/documentation/inspector/useNodeDetail'
import { usePageBody } from '@/features/documentation/inspector/usePageBody'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { Collaborator, DocumentationNode, NodeRelationship } from '@/types'

const PageEditor = lazy(() =>
  import('@/features/documentation/inspector/PageEditor').then((module) => ({ default: module.PageEditor })),
)

class EditorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('frontend.editor_load_failed', {
      errorMessage: error.message,
      componentStack: info.componentStack,
    })
  }

  override render() {
    if (!this.state.failed) return this.props.children

    return (
      <div role="alert" className="flex-1 space-y-3 p-6">
        <p className="text-sm">The editor could not be opened. You can keep reading or reload to try again.</p>
        <Button variant="outline" onClick={this.props.onClose}>Back to page</Button>
        <Button variant="ghost" onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    )
  }
}

/**
 * A node, as a page.
 *
 * This used to be a form: a properties panel, a list of typed content blocks, and an "add
 * block" button that asked you to choose between Markdown, table, code and four other
 * things before you could write a sentence. That is a data-model editor, not a
 * documentation tool, and it shows -- the first decision the interface demanded was one
 * the author had no reason to care about.
 *
 * So the shape is a page instead. The title is the title, edited in place. The two
 * properties that mean something to a reader -- what kind of thing this is, and how deep
 * it sits -- are dropdowns on one line, which is also what stops them eating the width
 * the prose needs. Everything else is body: one document, Markdown underneath, `@` to
 * link another node, and the blocks it is stored as are an implementation detail the
 * author never meets.
 *
 * Relationships stay, because they are the one part of a node that is genuinely not
 * prose: they are the graph. They sit below the body, collapsed, where a reader who wants
 * to know what this connects to can find them without the page opening on a list of
 * arrows.
 */


export function InspectorPanel({
  nodeId,
  spaceId,
  levelNodes = [],
  editable = true,
  back = null,
  initialBlockIndex = null,
  collaborator,
  onClose,
  onSelectNode,
  onDeleteNode,
  onDeleteRelationship,
  onNodeChanged,
  onTitleLoaded,
}: {
  nodeId: string
  spaceId: string
  levelNodes?: DocumentationNode[]
  editable?: boolean
  back?: { title: string; onBack: () => void } | null
  /**
   * Which paragraph of this page a link asked to land on. Read once, by `PageView`, then
   * forgotten -- see `Show.tsx`'s `linkedBlock` for where it comes from and why it is not
   * kept in sync afterward.
   */
  initialBlockIndex?: number | null
  /** Whoever is signed in. Passed through to `PageEditor`, whose own caret needs it. */
  collaborator: Collaborator
  onClose: () => void
  onSelectNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onDeleteRelationship: (relationshipId: string) => void
  onNodeChanged: () => void
  onTitleLoaded?: (nodeId: string, title: string) => void
}) {
  const { detail, loading, saving, error, dismissError, saveNodeFields, savePage } = useNodeDetail(
    nodeId,
    onNodeChanged,
  )

  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (detail?.title) onTitleLoaded?.(nodeId, detail.title)
  }, [detail?.title, nodeId, onTitleLoaded])

  const page = usePageBody({
    document: useCollaborativeDocument(nodeId),
    blocks: detail?.contentBlocks ?? [],
    saving,
    onSave: savePage,
  })

  const candidates = useMemo<MentionCandidate[]>(
    () =>
      levelNodes
        .filter((node) => node.id !== nodeId)
        .map((node) => ({ id: node.id, title: node.title })),
    [levelNodes, nodeId],
  )

  const searchMentions = useCallback(
    async (query: string): Promise<MentionCandidate[]> => {
      const results = await api.searchDocumentation({ spaceId, query })

      return results
        .filter((result) => result.node.id !== nodeId)
        .map((result) => ({ id: result.node.id, title: result.node.title }))
    },
    [nodeId, spaceId],
  )

  if (loading && !detail) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">This node could not be loaded.</p>
      </div>
    )
  }

  const relationshipCount = detail.outgoingRelationships.length + detail.incomingRelationships.length

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b border-border px-6 pb-3 pt-4">
        {back ? (
          <button
            type="button"
            onClick={back.onBack}
            className="-ml-1 flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowLeft className="size-3 shrink-0" aria-hidden />
            {/* Named, not just "Back": after following two mentions, "back" on its own
                does not say where to. */}
            <span className="truncate">Back to {back.title}</span>
          </button>
        ) : null}

        <div className="flex items-start gap-2">
          <TitleField
            title={detail.title}
            editable={editable}
            onSave={(title) => void saveNodeFields({ title })}
          />
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close inspector" className="shrink-0">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/*
            The same mark the card carries, with the label spelled out because there is
            room for it here. Counted from this node's own edges rather than from the
            server's number: the page has the full list in front of it, which is the same
            fact the count is derived from and cannot be a level out of date.
          */}
          {isDisconnected(relationshipCount) ? (
            <span
              className="inline-flex items-center gap-1 rounded-xs bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={DISCONNECTED_HINT}
            >
              <DisconnectedIcon className="size-3" aria-hidden />
              {DISCONNECTED_LABEL}
            </span>
          ) : null}

          {editable && !editing ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
              <Pencil className="size-3" />
              Edit
            </Button>
          ) : null}
        </div>

        <SummaryField
          summary={detail.summary ?? ''}
          editable={editable}
          onSave={(summary) => void saveNodeFields({ summary })}
        />

        {/*
          Who else has this page open, right now, in the same round photo the header bar
          uses -- so a face here and a face there are recognisably the same fact read from
          two distances. Under the summary rather than up on the title row: the title and
          the summary are both *about the node*, and this is the last line of that before
          the page itself starts, not a fact competing with Edit for space on one row.
        */}
        {page.viewers.length > 0 ? (
          <div
            className="flex -space-x-1"
            aria-label={`${page.viewers.length} other ${page.viewers.length === 1 ? 'person is' : 'people are'} viewing this page`}
          >
            {page.viewers.map((viewer) => (
              <PersonAvatar key={viewer.id} actor={viewer} size="xs" />
            ))}
          </div>
        ) : null}
      </header>

      {error ? <Banner message={error} onDismiss={dismissError} /> : null}

      {editing ? (
        <EditorBoundary onClose={() => setEditing(false)}>
          <Suspense fallback={
            <div className="flex-1 space-y-3 p-6">
              <p role="status" className="text-sm text-muted-foreground">Loading editor…</p>
              <Skeleton className="h-40 w-full" />
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          }>
            <PageEditor
              page={page}
              candidates={candidates}
              collaborator={collaborator}
              nodeId={nodeId}
              onSearchMentions={searchMentions}
              onDone={() => setEditing(false)}
            />
          </Suspense>
        </EditorBoundary>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PageView
            nodeId={nodeId}
            markdown={page.value}
            remoteAuthor={page.remoteAuthor}
            editable={editable}
            highlightBlockIndex={initialBlockIndex}
            onSelectNode={onSelectNode}
            onEdit={() => setEditing(true)}
          />

          <section className="border-t border-border">
            <Collapsible
              title="Relationships"
              count={relationshipCount}
              icon={Link2}
              defaultOpen={relationshipCount > 0 && relationshipCount <= 8}
            >
              {relationshipCount === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Not connected to anything yet. Drag from the right edge of a node to the left edge of
                  another to create a relationship.
                </p>
              ) : (
                <ul className="space-y-1">
                  {detail.outgoingRelationships.map((relationship) => (
                    <RelationshipRow
                      key={relationship.id}
                      relationship={relationship}
                      direction="out"
                      onSelectNode={onSelectNode}
                      onDelete={editable ? onDeleteRelationship : null}
                    />
                  ))}
                  {detail.incomingRelationships.map((relationship) => (
                    <RelationshipRow
                      key={relationship.id}
                      relationship={relationship}
                      direction="in"
                      onSelectNode={onSelectNode}
                      onDelete={editable ? onDeleteRelationship : null}
                    />
                  ))}
                </ul>
              )}
            </Collapsible>
          </section>
        </div>
      )}

      <footer className="flex items-center gap-3 border-t border-border px-6 py-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          {Math.round(detail.position.x)}, {Math.round(detail.position.y)}, {Math.round(detail.position.z)}
        </span>

        {editable ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => onDeleteNode(detail.id)}
          >
            <Trash2 className="size-3" />
            Delete node
          </Button>
        ) : null}
      </footer>
    </div>
  )
}

/**
 * The page as a reader sees it.
 *
 * The same Markdown the editor renders, through the same renderer and the same
 * stylesheet. Reading and editing are one surface with one appearance, and the only
 * visible difference between them is the toolbar: that is the point of the editor being
 * formatted at all, and it is worth more than the block-by-block rendering this replaced,
 * where a seeded table was drawn by a component the editor had no equivalent for and the
 * page visibly changed shape the moment somebody clicked into it.
 */
function PageView({
  nodeId,
  markdown,
  remoteAuthor,
  editable,
  highlightBlockIndex = null,
  onSelectNode,
  onEdit,
}: {
  nodeId: string
  markdown: string
  /** See `usePageBody`'s field of the same name -- who a block that just changed gets
   * attributed to. */
  remoteAuthor: RemoteAuthor | null
  editable: boolean
  /** Land on and flash this paragraph once the page has rendered. See `Show.tsx`'s
   * `linkedBlock` for where the number comes from. */
  highlightBlockIndex?: number | null
  onSelectNode: (nodeId: string) => void
  onEdit: () => void
}) {
  const container = useRef<HTMLDivElement>(null)

  /*
   * Runs once per arrival, not once per render: `markdown` changes on every keystroke a
   * collaborator makes, and re-scrolling a reader to a fixed paragraph every time someone
   * else typed a word would make the page unusable to read while it was being edited.
   *
   * Waiting on `markdown` at all, rather than firing straight from `Show.tsx`, is what
   * makes the target exist to find: this effect runs after the paragraph in question has
   * actually been rendered, where one keyed off page load alone would run before
   * `MarkdownBlock` had produced it.
   */
  const landed = useRef(false)

  useEffect(() => {
    if (landed.current || highlightBlockIndex === null) return

    const target = container.current?.querySelector<HTMLElement>(
      `.documentation-markdown > [data-block-index="${highlightBlockIndex}"]`,
    )
    if (!target) return

    landed.current = true
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // A flash rather than a standing highlight: this marks *arrival*, the way a browser's
    // own find-in-page does, not "this paragraph is special" -- which a highlight that
    // never went away would end up claiming.
    target.classList.add('block-highlight')
    const timer = window.setTimeout(() => target.classList.remove('block-highlight'), 2200)

    return () => window.clearTimeout(timer)
  }, [markdown, highlightBlockIndex])

  if (!markdown.trim()) {
    return (
      <div className="px-6 py-6">
        {editable ? (
          <button
            type="button"
            onClick={onEdit}
            className="w-full rounded-sm border border-dashed border-border px-4 py-8 text-left text-sm text-muted-foreground hover:border-ring hover:text-foreground"
          >
            Write something about this node…
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing documented yet.</p>
        )}
      </div>
    )
  }

  return (
    // The editor's padding, exactly: the text must not move when editing starts.
    //
    // Clicking the page deliberately does nothing. It used to open the editor, the way a
    // document does, and the cost was that dragging across a paragraph to copy it -- a
    // click, as far as the DOM is concerned -- swapped the text for an editing surface
    // mid-selection. Reading is the common case; editing starts from the Edit button.
    <div ref={container} className="px-6 py-4">
      <MarkdownBlock
        nodeId={nodeId}
        data={{ markdown }}
        remoteAuthor={remoteAuthor}
        onNavigateToNode={onSelectNode}
      />
    </div>
  )
}

/**
 * The title, edited where it is displayed.
 *
 * A heading that becomes an input on click, rather than a field inside an edit mode. The
 * node's name is the thing people fix most often and the thing a wrong click on "Edit"
 * used to hide behind three other fields.
 */
function TitleField({
  title,
  editable,
  onSave,
}: {
  title: string
  editable: boolean
  onSave: (title: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null || !editable) {
    return (
      // The button is inside the heading rather than replacing it. A node's title is the
      // page's heading to anything navigating by structure, and "make it editable" is no
      // reason to take that away.
      <h2 className="min-w-0 flex-1 text-xl font-semibold leading-snug">
        {editable ? (
          <button
            type="button"
            title="Click to rename"
            onClick={() => setDraft(title)}
            className="w-full cursor-text rounded-sm text-left hover:bg-muted/60"
          >
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
    )
  }

  const commit = () => {
    const next = draft.trim()
    setDraft(null)
    if (next && next !== title) onSave(next)
  }

  return (
    <input
      value={draft}
      autoFocus
      aria-label="Title"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          event.stopPropagation()
          setDraft(null)
        }
      }}
      className="min-w-0 flex-1 rounded-sm bg-transparent text-xl font-semibold leading-snug focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    />
  )
}

/** One line under the title: what this node is, for someone scanning the canvas. */
function SummaryField({
  summary,
  editable,
  onSave,
}: {
  summary: string
  editable: boolean
  onSave: (summary: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  if (!editable) {
    return summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null
  }

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(summary)}
        className={cn(
          'block w-full cursor-text rounded-sm text-left text-sm hover:bg-muted/60',
          summary ? 'text-muted-foreground' : 'text-muted-foreground/70',
        )}
      >
        {summary || 'Add a one-line summary…'}
      </button>
    )
  }

  const commit = () => {
    const next = draft.trim()
    setDraft(null)
    if (next !== summary) onSave(next)
  }

  return (
    <input
      value={draft}
      autoFocus
      aria-label="Summary"
      placeholder="A one-line summary"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          event.stopPropagation()
          setDraft(null)
        }
      }}
      className="w-full rounded-sm bg-transparent text-sm text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    />
  )
}


function Collapsible({
  title,
  count,
  icon: Icon,
  defaultOpen,
  children,
}: {
  title: string
  count: number
  icon: typeof Link2
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="px-6 py-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-3.5" aria-hidden />
        {title}
        <span className="font-mono text-[10px] font-normal">{count}</span>
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}

function Banner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 border-b border-border bg-destructive/10 px-6 py-2 text-xs text-destructive"
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="font-medium underline">
        Dismiss
      </button>
    </div>
  )
}

function RelationshipRow({
  relationship,
  direction,
  onSelectNode,
  onDelete,
}: {
  relationship: NodeRelationship
  direction: 'in' | 'out'
  onSelectNode: (nodeId: string) => void
  /** Null for a reader: the row stays navigable, it just cannot be unpicked. */
  onDelete: ((relationshipId: string) => void) | null
}) {
  const other = direction === 'out' ? relationship.targetNode : relationship.sourceNode
  const otherId = direction === 'out' ? relationship.targetNodeId : relationship.sourceNodeId
  const Icon = direction === 'out' ? ArrowRight : ArrowLeft

  return (
    <li className="group flex items-center gap-1.5 text-xs">
      <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {relationship.relationshipType.replace(/_/g, ' ')}
      </span>
      {/*
        Selecting a related node moves the canvas to it rather than opening a page. That
        is the navigation model: the user stays in one spatial context and the inspector
        follows the selection, so "back" means selecting where they came from rather than
        unwinding browser history.
      */}
      <button
        type="button"
        onClick={() => onSelectNode(otherId)}
        className="min-w-0 flex-1 truncate text-left hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      >
        {other?.title ?? `Node ${otherId}`}
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(relationship.id)}
          aria-label="Remove relationship"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
        </button>
      ) : null}
    </li>
  )
}
