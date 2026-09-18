import { useMemo } from 'react'
import { NodeApi, type TElement } from 'platejs'
import { PlateElement, PlateLeaf, useEditorRef, type PlateElementProps, type PlateLeafProps } from 'platejs/react'
import { CODE_LANGUAGES } from '@/features/documentation/blocks/highlight'
import { MENTION_HREF_PREFIX } from '@/features/documentation/inspector/mentions'
import { useMentionSource } from '@/features/documentation/editor/MentionSource'
import { MentionPicker, useMentionCandidates } from '@/features/documentation/editor/MentionPicker'

/**
 * How each kind of node in a page is drawn.
 *
 * The editor and the reader's page are the same document in two renderers -- this one and
 * `renderMarkdown` -- so both produce the same elements and both are styled by
 * `.documentation-markdown`. An editor that looks different from the published result is
 * the failure mode this surface exists to avoid, and the cheapest way to avoid it is to
 * emit the tags Markdown itself implies: a heading is an `<h2>`, a list is a `<ul>`, a
 * table is a `<table>`.
 *
 * Everything here is presentation. What a key means, what may nest inside what, and what
 * Enter does in each is the plugins' business -- which is the whole reason this is a short
 * file and the editor it replaced was not.
 */

/**
 * A paragraph, drawn as a `<div>` rather than a `<p>`.
 *
 * Plate's own choice, and for a reason that only shows up once lists exist: an indented
 * block *is* the list item, so the marker and its `<ol>` are rendered inside the block's
 * element -- and a `<p>` may not contain an `<ol>`. The spacing comes from the class
 * either way, since `.documentation-markdown` spaces siblings rather than paragraphs.
 */
export function ParagraphElement(props: PlateElementProps) {
  return <PlateElement {...props} />
}

export function H1Element(props: PlateElementProps) {
  return <PlateElement {...props} as="h1" />
}

export function H2Element(props: PlateElementProps) {
  return <PlateElement {...props} as="h2" />
}

export function H3Element(props: PlateElementProps) {
  return <PlateElement {...props} as="h3" />
}

export function BlockquoteElement(props: PlateElementProps) {
  return <PlateElement {...props} as="blockquote" />
}



/**
 * A table, with the `<tbody>` a browser would otherwise insert itself.
 *
 * Rows are not allowed to be a table's direct children, and leaving them there means the
 * markup React rendered and the markup in the document disagree from the first paint.
 */
export function TableElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="table">
      <tbody>{props.children}</tbody>
    </PlateElement>
  )
}

export function TableRowElement(props: PlateElementProps) {
  return <PlateElement {...props} as="tr" />
}

/**
 * A divider, which holds no text and so must not be typed into.
 *
 * Slate requires every element to render its children even when there are none to show,
 * so they go in a wrapper the caret cannot enter.
 */
export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props}>
      <div contentEditable={false}>
        <hr />
      </div>
      {props.children}
    </PlateElement>
  )
}

export function TableCellElement(props: PlateElementProps) {
  const header = props.element.type === 'th'

  return (
    <PlateElement
      {...props}
      as={header ? 'th' : 'td'}
      attributes={{
        ...props.attributes,
        colSpan: cellSpan(props.element, 'colSpan'),
        rowSpan: cellSpan(props.element, 'rowSpan'),
      }}
    />
  )
}

function cellSpan(element: TElement, key: 'colSpan' | 'rowSpan'): number | undefined {
  const value = element[key]

  return typeof value === 'number' && value > 1 ? value : undefined
}

/**
 * A code block: the snippet, its line numbers, and the control that says what language it
 * is in.
 *
 * The numbers are drawn by CSS from a counter rather than put in the DOM. That is not only
 * tidier -- it makes them impossible to select, impossible to copy with the code, and
 * impossible to save into the document, none of which was true of a gutter made of text.
 *
 * The language is a dropdown in the corner rather than a question asked at insertion,
 * because it is the one property of a snippet an author knows for certain only once the
 * code is in front of them. Changing it rewrites the word after the fence in the saved
 * Markdown, so it is a document edit and not a display setting.
 */
export function CodeBlockElement(props: PlateElementProps) {
  const editor = useEditorRef()
  const language = typeof props.element.lang === 'string' ? props.element.lang : ''

  return (
    <PlateElement {...props} as="pre" className="code-block">
      {/*
        Chrome, in a wrapper the document does not own. Without the wrapper the caret can
        be placed beside the control and text typed there lands between the block and its
        code -- somewhere the document has no room for it.
      */}
      <div className="code-language" contentEditable={false}>
        <select
          aria-label="Code language"
          value={language || 'plaintext'}
          onChange={(event) => editor.tf.setNodes({ lang: event.target.value }, { at: props.path })}
        >
          {CODE_LANGUAGES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <code className="hljs">{props.children}</code>
    </PlateElement>
  )
}

export function CodeLineElement(props: PlateElementProps) {
  return <PlateElement {...props} as="span" className="code-line" />
}

/** One highlighted token. The class is Highlight.js's, so the page's own theme colours it. */
export function CodeSyntaxLeaf(props: PlateLeafProps) {
  const className = props.leaf.className

  return <PlateLeaf {...props} className={typeof className === 'string' ? className : undefined} />
}

/** A link. Opened safely, the same way the reader's page opens one. */
export function LinkElement(props: PlateElementProps) {
  const url = typeof props.element.url === 'string' ? props.element.url : ''

  return (
    <PlateElement
      {...props}
      as="a"
      attributes={{
        ...props.attributes,
        href: url,
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      }}
    />
  )
}

/**
 * A mention: a link to another node in this space.
 *
 * An inline void, because it is one thing rather than editable text -- typing at the edge
 * of a chip must not extend its label. It is stored as a link whose target names a node,
 * which is this application's one piece of syntax, and the `#node-` href is what the
 * reader's page recognises to turn a click into navigation.
 */
export function MentionElement(props: PlateElementProps) {
  const { element } = props
  const id = String(element.key ?? element.value ?? '')
  const title = String(element.value ?? '')

  return (
    <PlateElement
      {...props}
      as="a"
      attributes={{ ...props.attributes, href: `${MENTION_HREF_PREFIX}${id}` }}
    >
      {`@${title}`}
      {props.children}
    </PlateElement>
  )
}

/**
 * The `@` being typed, and the nodes it could become.
 *
 * Plate keeps the query as an element in the document rather than as component state,
 * which is what makes it survive a re-render and what makes the caret behave: it is text
 * in the document until it is replaced by a chip. The picker hangs off it.
 */
export function MentionInputElement(props: PlateElementProps) {
  const editor = useEditorRef()
  const source = useMentionSource()
  const query = useMemo(() => NodeApi.string(props.element), [props.element])

  const matches = useMentionCandidates({
    query,
    candidates: source.candidates,
    onSearch: source.onSearchMentions,
  })

  return (
    <PlateElement {...props} as="span" className="relative">
      <span className="rounded-sm bg-accent px-0.5">{props.children}</span>
      <MentionPicker
        query={query}
        matches={matches}
        onPick={(candidate) => source.onSelect(editor, candidate, query)}
      />
    </PlateElement>
  )
}
