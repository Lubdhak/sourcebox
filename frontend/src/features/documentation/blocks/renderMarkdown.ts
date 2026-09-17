import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { codeBlockHtml, resolveLanguage } from '@/features/documentation/blocks/highlight'

/**
 * Markdown to HTML, sanitized.
 *
 * The one place in the application that turns user-written Markdown into markup, used
 * both by the reader's page and by the editor that renders the same document for editing.
 * Having two would mean two sanitizer configurations, and the second one would be the
 * one that was wrong.
 *
 * Markdown permits raw HTML by specification -- `<img onerror=...>` and
 * `<a href="javascript:...">` are valid input -- and this content is written by users and
 * read by others, so the output is sanitized rather than trusted. DOMPurify strips
 * scripts, event handlers and dangerous URL schemes while leaving ordinary formatting
 * intact.
 *
 * Hand-rolling either half would be the wrong call: a Markdown parser is a real parser,
 * and an HTML sanitizer is a security control that has to be wrong zero times.
 *
 * There is one output, deliberately, including for code blocks: the editing surface shows
 * the same highlighting, the same line numbers and the same language label as the page,
 * because an editor that renders a plain grey box where the reader sees a coloured,
 * numbered snippet is an editor people stop trusting. Two mechanics pay for that -- the
 * serializer drops the gutter instead of saving it as text, and the editor re-tokenises
 * the block being typed in -- and both live next to the code they protect.
 */

const markdown = new Marked({ async: false, gfm: true, breaks: true }).use({
  renderer: {
    code({ text, lang }) {
      const language = resolveLanguage(lang)

      // The language is kept on the element as well as in the class because the page
      // shows it: a snippet whose language is not labelled is a snippet somebody has to
      // guess at.
      return (
        `<pre class="code-block"${language ? ` data-language="${language}"` : ''}>` +
        `${codeBlockHtml(text, language)}</pre>`
      )
    },
  },
})

export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''

  const parsed = markdown.parse(source) as string

  return DOMPurify.sanitize(parsed, {
    // Anchors are allowed; the renderer rewrites each one to open safely. `contenteditable`
    // is allowed because the line-number gutter carries `false`, which is what keeps a
    // caret out of it when this markup is rendered into the editing surface.
    ADD_ATTR: ['target', 'rel', 'contenteditable'],
    // `input` is permitted for one reason: a GFM task list is a disabled checkbox, and
    // forbidding the tag silently deleted every checklist anyone wrote. Scripts and
    // handlers are still stripped, and `form` is still forbidden, so a checkbox has
    // nothing to submit to and nothing to run.
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
  })
}
