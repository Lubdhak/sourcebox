import { readCsrfToken } from '@/lib/csrf'
import { logger } from '@/lib/logger'

/**
 * Minimal typed GraphQL client.
 *
 * Uses `fetch` directly rather than Inertia's pluggable `http` client. Inertia v3 dropped
 * its Axios dependency and exposes `http` for reuse, but that client is built around the
 * Inertia protocol: it interprets responses as page objects and routes failures through
 * Inertia's error handling. A GraphQL response is not an Inertia page, so running it
 * through that pipeline would mean fighting the abstraction.
 *
 * There is no Apollo or urql here either. Those exist mainly for their normalized caches,
 * and this application's client state is a single dashboard document that Rails already
 * owns. Adding a normalizing cache would create a second source of truth to keep in sync.
 * When you need cache normalization, subscriptions or fragment-level codegen, that is the
 * point to reach for a real client — not before.
 *
 * The URL is relative on purpose. The JS module is served from the frontend origin, but
 * the *document* is served by Rails, so a relative fetch is same-origin against the
 * backend and the Devise session cookie is sent automatically.
 */

const ENDPOINT = '/graphql'

export interface GraphQLErrorShape {
  message: string
  path?: (string | number)[]
  extensions?: {
    code?: string
    /** Present on VALIDATION_FAILED: field name -> messages. */
    fields?: Record<string, string[]>
    /** Present on INTERNAL_ERROR, for correlating with server logs. */
    requestId?: string
  }
}

interface GraphQLResponse<TData> {
  data?: TData | null
  errors?: GraphQLErrorShape[]
}

/**
 * Thrown for both transport failures and GraphQL `errors`, so callers have one thing to
 * catch. `code` is the stable machine-readable code the schema returns
 * (UNAUTHENTICATED, NOT_FOUND, VALIDATION_FAILED, INTERNAL_ERROR).
 */
export class GraphQLRequestError extends Error {
  readonly errors: GraphQLErrorShape[]
  readonly code: string | undefined
  readonly status: number | undefined
  readonly fieldErrors: Record<string, string[]>

  constructor(message: string, options: { errors?: GraphQLErrorShape[]; status?: number } = {}) {
    super(message)
    this.name = 'GraphQLRequestError'
    this.errors = options.errors ?? []
    this.status = options.status
    this.code = this.errors[0]?.extensions?.code
    this.fieldErrors = this.errors[0]?.extensions?.fields ?? {}
  }

  get isUnauthenticated(): boolean {
    return this.code === 'UNAUTHENTICATED'
  }
}

export interface GraphQLRequestOptions {
  /** Names the operation in server logs and in the graphql.request event. */
  operationName?: string
  /** Lets a caller cancel an in-flight request, e.g. on unmount or when superseded. */
  signal?: AbortSignal
}

export async function graphql<TData, TVariables extends Record<string, unknown> = Record<string, never>>(
  query: string,
  variables?: TVariables,
  options: GraphQLRequestOptions = {},
): Promise<TData> {
  const startedAt = performance.now()

  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': readCsrfToken(),
        // Lets Rails distinguish an XHR from a document request.
        'X-Requested-With': 'XMLHttpRequest',
      },
      // Sends the Devise session cookie. Same-origin, so this is the default, but stated
      // explicitly because the whole auth model depends on it.
      credentials: 'same-origin',
      body: JSON.stringify({ query, variables: variables ?? {}, operationName: options.operationName }),
      signal: options.signal,
    })
  } catch (error) {
    // Network-level failure: offline, DNS, TLS, or an aborted request.
    if (error instanceof DOMException && error.name === 'AbortError') throw error

    logger.error('frontend.graphql_network_error', {
      operationName: options.operationName,
      durationMs: Math.round(performance.now() - startedAt),
    })
    throw new GraphQLRequestError('Could not reach the server. Check your connection.')
  }

  const durationMs = Math.round(performance.now() - startedAt)

  // A session that expired mid-visit returns a redirect to the login page. Following it
  // would replace the JSON with HTML and produce a confusing parse error, so it is
  // handled as the auth failure it actually is.
  if (response.status === 401 || response.redirected) {
    throw new GraphQLRequestError('Your session has expired. Please sign in again.', {
      status: response.status,
      errors: [{ message: 'Session expired', extensions: { code: 'UNAUTHENTICATED' } }],
    })
  }

  let body: GraphQLResponse<TData>
  try {
    body = (await response.json()) as GraphQLResponse<TData>
  } catch {
    logger.error('frontend.graphql_invalid_response', {
      operationName: options.operationName,
      status: response.status,
      durationMs,
    })
    throw new GraphQLRequestError('The server returned an unreadable response.', { status: response.status })
  }

  if (body.errors?.length) {
    const [first] = body.errors
    // Logged, but the payload is not: variables can contain user data, and the same rule
    // applies here as on the server.
    logger.warn('frontend.graphql_error', {
      operationName: options.operationName,
      code: first?.extensions?.code,
      requestId: first?.extensions?.requestId,
      durationMs,
    })
    throw new GraphQLRequestError(first?.message ?? 'The request failed.', {
      errors: body.errors,
      status: response.status,
    })
  }

  if (body.data === undefined || body.data === null) {
    throw new GraphQLRequestError('The server returned no data.', { status: response.status })
  }

  logger.debug('frontend.graphql_request', { operationName: options.operationName, durationMs })

  return body.data
}
