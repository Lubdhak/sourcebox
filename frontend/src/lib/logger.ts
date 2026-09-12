/**
 * Structured browser-side logging.
 *
 * Emits the same shape as the Rails JSON logs — an event name plus a flat payload — so
 * frontend and backend lines can be correlated in one place. Every line carries the
 * `requestId` of the Inertia page that produced it, which is what links a browser error
 * to the server request that rendered the page.
 *
 * This intentionally does not ship logs anywhere. Wiring in Sentry, Datadog RUM or a
 * custom collector is a one-line change in `emit`, and doing it here rather than at each
 * call site means the redaction rules below apply to all of it.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogPayload {
  [key: string]: unknown
}

/**
 * Keys never written to the log, matched as substrings against the lowercased key.
 *
 * The frontend has the same obligation as the server: a token or password must not end up
 * in a log line, and browser logs are arguably worse because they are visible to anyone
 * with the user's devtools open and to any script on the page.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'token',
  'secret',
  'credential',
  'authorization',
  'cookie',
  'session',
  'csrf',
  'apikey',
  'api_key',
]

const MAX_STRING_LENGTH = 512

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated: max depth]'

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value
  }

  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    // Bounded: an unbounded array in a log line is a denial-of-service on your own
    // logging pipeline.
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1))
  }

  const result: LogPayload = {}
  for (const [key, entry] of Object.entries(value as LogPayload)) {
    result[key] = isSensitiveKey(key) ? '[REDACTED]' : redact(entry, depth + 1)
  }
  return result
}

/**
 * Read from the Inertia page object rather than being passed around. Reaching into
 * `window` is the tradeoff for being able to call `logger.error` from anywhere,
 * including outside React, without threading context through every layer.
 */
function currentRequestId(): string | undefined {
  const el = document.querySelector('#app')
  if (!el) return undefined

  try {
    const raw = el.getAttribute('data-page')
    if (!raw) return undefined
    const page = JSON.parse(raw) as { props?: { requestId?: string } }
    return page.props?.requestId
  } catch {
    return undefined
  }
}

function emit(level: Level, event: string, payload: LogPayload = {}): void {
  const line = {
    event,
    level,
    timestamp: new Date().toISOString(),
    source: 'frontend',
    url: window.location.pathname,
    requestId: currentRequestId(),
    ...(redact(payload) as LogPayload),
  }

  // console[level] rather than console.log so the browser's own level filtering works,
  // and so `error` produces a stack trace in devtools.
  const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level === 'warn' ? 'warn' : 'error'
  console[method](JSON.stringify(line))
}

export const logger = {
  debug: (event: string, payload?: LogPayload) => emit('debug', event, payload),
  info: (event: string, payload?: LogPayload) => emit('info', event, payload),
  warn: (event: string, payload?: LogPayload) => emit('warn', event, payload),
  error: (event: string, payload?: LogPayload) => emit('error', event, payload),
}

/**
 * Reports navigation timing once per page load.
 *
 * Uses the Navigation Timing API rather than timing things by hand, so the numbers include
 * everything the browser did before our JS ran — DNS, TLS, the request itself, and HTML
 * parsing. Those are exactly the phases a hand-rolled timer cannot see.
 */
export function reportNavigationTiming(): void {
  // Deferred to the load event: several of these fields are still 0 while the page is
  // loading, which would report misleadingly fast timings.
  const report = () => {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    if (!entry) return

    const paint = performance.getEntriesByName('first-contentful-paint')[0]

    logger.info('frontend.navigation', {
      type: entry.type,
      // Time to first byte: dominated by the server.
      ttfbMs: Math.round(entry.responseStart - entry.requestStart),
      // DOM ready and full load: dominated by asset size and our own JS.
      domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd - entry.startTime),
      loadCompleteMs: Math.round(entry.loadEventEnd - entry.startTime),
      // What the user actually perceives.
      firstContentfulPaintMs: paint ? Math.round(paint.startTime) : undefined,
      transferredBytes: entry.transferSize,
    })
  }

  if (document.readyState === 'complete') {
    report()
  } else {
    window.addEventListener('load', report, { once: true })
  }
}
