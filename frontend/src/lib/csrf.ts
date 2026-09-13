/**
 * Rails' CSRF token for native forms and fetch.
 *
 * The layout's <meta name="csrf-token"> is only written on a full document response.
 * Inertia visits replace the page JSON without replacing that meta tag, so a form that
 * reads the tag from a previous visit will post a token the new session no longer
 * accepts. Shared `csrfToken` is the value from this visit; `writeCsrfToken` copies it
 * onto the meta tag so graphql.ts and native forms stay in lockstep.
 */
export function readCsrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
}

export function writeCsrfToken(token: string): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
  if (meta) meta.content = token
}
