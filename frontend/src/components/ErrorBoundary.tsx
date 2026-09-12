import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { logger } from '@/lib/logger'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions anywhere below it and shows a recoverable fallback
 * instead of React unmounting the entire tree and leaving a blank white page.
 *
 * Still a class component: `componentDidCatch` has no hook equivalent, in React 19 or
 * otherwise. This is the one place a class is genuinely required.
 *
 * Note what it does NOT catch, so its limits are clear: event handlers, `setTimeout`
 * callbacks, and rejected promises all run outside React's render phase. Async GraphQL
 * failures are handled at the call site; this is the backstop for bad render logic and for
 * malformed props.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is what makes a minified production error diagnosable; the
    // message alone rarely identifies which component failed.
    logger.error('frontend.render_error', {
      errorName: error.name,
      errorMessage: error.message,
      componentStack: info.componentStack,
    })
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            This part of the page failed to render. The error has been logged.
          </p>

          {/* The message is shown only in development. In production it can leak internal
              detail, and it means nothing to a user. */}
          {import.meta.env.DEV && (
            <pre className="mt-4 max-h-48 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {error.name}: {error.message}
            </pre>
          )}

          <div className="mt-6 flex gap-3">
            {/* Re-render rather than reload: if the failure was transient (a race, a
                momentarily missing prop) this recovers without losing the session. */}
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
