import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import nginx from 'highlight.js/lib/languages/nginx'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import protobuf from 'highlight.js/lib/languages/protobuf'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/**
 * Syntax highlighting for code in documentation.
 *
 * Highlight.js, registered language by language rather than imported whole. The full
 * bundle is around 200 grammars and dwarfs the rest of this application; the list below
 * is the set a system-documentation tool actually meets -- the languages services are
 * written in, the formats configuration comes in, and the three that are not languages at
 * all but are pasted constantly (diff, Dockerfile, nginx). A grammar that is not in the
 * list costs nothing and degrades to unhighlighted text, so adding one is a one-line
 * change rather than a decision.
 *
 * This is also where the line numbers come from, and they are deliberately *not* part of
 * the highlighted markup. A number in the DOM is a number in `textContent`: it would be
 * copied with the snippet, and -- because the editor serializes the page it renders back
 * into Markdown -- it would be saved into the document. So the numbers are a separate
 * element, which the serializer deletes and CSS puts in the margin. That separation is
 * what lets the editor render a code block exactly as the page does instead of showing a
 * plain grey box where the reader sees coloured, numbered code.
 */

interface Grammar {
  id: string
  label: string
  register: Parameters<typeof hljs.registerLanguage>[1]
  /** What people write in a fence for this language. */
  aliases?: string[]
}

const GRAMMARS: Grammar[] = [
  { id: 'bash', label: 'Bash', register: bash, aliases: ['sh', 'zsh', 'console'] },
  { id: 'c', label: 'C', register: c, aliases: ['h'] },
  { id: 'cpp', label: 'C++', register: cpp, aliases: ['c++', 'cc', 'hpp'] },
  { id: 'csharp', label: 'C#', register: csharp, aliases: ['cs'] },
  { id: 'css', label: 'CSS', register: css },
  { id: 'diff', label: 'Diff', register: diff, aliases: ['patch'] },
  { id: 'dockerfile', label: 'Dockerfile', register: dockerfile, aliases: ['docker'] },
  { id: 'go', label: 'Go', register: go, aliases: ['golang'] },
  { id: 'graphql', label: 'GraphQL', register: graphql, aliases: ['gql'] },
  { id: 'ini', label: 'INI / TOML', register: ini, aliases: ['toml', 'conf'] },
  { id: 'java', label: 'Java', register: java },
  { id: 'javascript', label: 'JavaScript', register: javascript, aliases: ['js', 'jsx', 'mjs', 'node'] },
  { id: 'json', label: 'JSON', register: json, aliases: ['jsonc'] },
  { id: 'kotlin', label: 'Kotlin', register: kotlin, aliases: ['kt'] },
  { id: 'lua', label: 'Lua', register: lua },
  { id: 'makefile', label: 'Makefile', register: makefile, aliases: ['make', 'mk'] },
  { id: 'markdown', label: 'Markdown', register: markdown, aliases: ['md'] },
  { id: 'nginx', label: 'nginx', register: nginx },
  { id: 'php', label: 'PHP', register: php },
  { id: 'plaintext', label: 'Plain text', register: plaintext, aliases: ['text', 'txt', 'log'] },
  { id: 'protobuf', label: 'Protocol Buffers', register: protobuf, aliases: ['proto'] },
  { id: 'python', label: 'Python', register: python, aliases: ['py'] },
  { id: 'ruby', label: 'Ruby', register: ruby, aliases: ['rb', 'erb'] },
  { id: 'rust', label: 'Rust', register: rust, aliases: ['rs'] },
  { id: 'scala', label: 'Scala', register: scala },
  { id: 'shell', label: 'Shell session', register: shell },
  { id: 'sql', label: 'SQL', register: sql, aliases: ['postgres', 'postgresql', 'mysql'] },
  { id: 'swift', label: 'Swift', register: swift },
  { id: 'typescript', label: 'TypeScript', register: typescript, aliases: ['ts', 'tsx'] },
  { id: 'xml', label: 'HTML / XML', register: xml, aliases: ['html', 'svg', 'rss', 'xhtml'] },
  { id: 'yaml', label: 'YAML', register: yaml, aliases: ['yml'] },
]

for (const grammar of GRAMMARS) {
  hljs.registerLanguage(grammar.id, grammar.register)
  for (const alias of grammar.aliases ?? []) hljs.registerAliases(alias, { languageName: grammar.id })
}

/** Offered by the editor when inserting a code block. */
export const CODE_LANGUAGES: { id: string; label: string }[] = GRAMMARS.map(({ id, label }) => ({
  id,
  label,
}))

/**
 * The grammar a fence's language names, or null.
 *
 * Null rather than a guess. Highlight.js can detect a language from the source, and on a
 * four-line snippet it is wrong often enough to be worse than plain text: mis-coloured
 * code reads as a different language than it is.
 */
export function resolveLanguage(name: string | null | undefined): string | null {
  if (!name) return null

  // A fence can carry more than a language -- ```js title="x" is common -- and only the
  // first word names the grammar.
  const requested = name.trim().toLowerCase().split(/[\s:,]/)[0]
  if (!requested) return null

  if (GRAMMARS.some((grammar) => grammar.id === requested)) return requested

  return GRAMMARS.find((grammar) => grammar.aliases?.includes(requested))?.id ?? null
}

export function languageLabel(language: string | null): string {
  return GRAMMARS.find((grammar) => grammar.id === language)?.label ?? language ?? 'code'
}

/**
 * One code block, as markup: a gutter of line numbers and the highlighted source.
 *
 * Returned as a string rather than as elements because both callers need a string -- the
 * Markdown renderer emits it inline, and the typed code block sets it as HTML. The
 * escaping is Highlight.js's when a language is known and ours when it is not, and both
 * matter: this text is written by one user and read by others.
 */
export function codeBlockHtml(code: string, language: string | null): string {
  const body = code.replace(/\n$/, '')
  const lines = body.split('\n')

  const numbers = lines.map((_, index) => index + 1).join('\n')
  const highlighted = language
    ? hljs.highlight(body, { language, ignoreIllegals: true }).value
    : escapeHtml(body)

  return (
    // `contenteditable="false"` because this markup is also what the editor shows: the
    // caret must not be able to get into the gutter and type between the numbers. The
    // serializer drops the element entirely, so it never reaches the saved document.
    `<span class="code-gutter" aria-hidden="true" contenteditable="false">${numbers}</span>` +
    `<code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code>`
  )
}

/** The language a rendered code block was highlighted by, read back off the element. */
export function languageOf(element: Element | null): string | null {
  const code = element?.querySelector('code') ?? element
  const match = /language-(\S+)/.exec(code?.className ?? '')

  return resolveLanguage(match?.[1] ?? null)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
