import { Head, router, useHttp, usePage } from '@inertiajs/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { graphql, GraphQLRequestError } from '@/lib/graphql'
import { logger } from '@/lib/logger'
import type { DashboardPageProps, InertiaSharedProps, Layout, Theme, UiState } from '@/types'

/**
 * The heavy-client-state page.
 *
 * Division of responsibility, which is the whole point of pairing Inertia with GraphQL:
 *
 *   Inertia  — navigation and the initial render. Rails picks the component and supplies
 *              the first snapshot, so there is content on first paint and no loading
 *              spinner on entry.
 *   GraphQL  — every subsequent read and write. The client drives these, they are
 *              fine-grained, and they must not re-render the page or touch history.
 *
 * A theme toggle as an Inertia visit would be wrong: it would push a history entry, remount
 * the page, and make the back button undo a preference change.
 */

const DASHBOARD_QUERY = /* GraphQL */ `
  query Dashboard($id: ID!) {
    dashboard(id: $id) {
      id
      uiState {
        theme
        layout
        visibleWidgets
        widgetSettings
      }
    }
  }
`

const UPDATE_STATE_MUTATION = /* GraphQL */ `
  mutation UpdateDashboardState($dashboardId: ID!, $uiState: DashboardUiStateInput!) {
    updateDashboardState(input: { dashboardId: $dashboardId, uiState: $uiState }) {
      dashboard {
        id
        uiState {
          theme
          layout
          visibleWidgets
          widgetSettings
        }
      }
    }
  }
`

interface DashboardQueryResult {
  dashboard: { id: string; uiState: UiState }
}

interface UpdateStateResult {
  updateDashboardState: { dashboard: { id: string; uiState: UiState } }
}

const ALL_WIDGETS = ['revenue', 'signups', 'latency'] as const
const THEMES: Theme[] = ['LIGHT', 'DARK', 'SYSTEM']
const LAYOUTS: Layout[] = ['GRID', 'LIST']

export default function DashboardShow({ dashboardId, initialUiState }: DashboardPageProps) {
  const { currentUser } = usePage<InertiaSharedProps>().props

  // Seeded from the Inertia props, so the first paint is real content. Because the
  // controller serializes in the same shape GraphQL returns, no conversion is needed.
  const [uiState, setUiState] = useState<UiState>(initialUiState)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Holds the last server-confirmed state so a failed mutation can roll back to it.
  // A ref rather than state: it must not trigger a render, and the rollback handler needs
  // the current value without being re-created on every change.
  const confirmedState = useRef<UiState>(initialUiState)

  // Cancels an in-flight request when a newer one supersedes it or the page unmounts.
  // Without this, a slow response can land after a newer one and overwrite it.
  const inFlight = useRef<AbortController | null>(null)

  // Applies the theme to <html> so Tailwind's `dark:` variant takes effect. Server state
  // drives the DOM; SYSTEM defers to the OS preference.
  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = uiState.theme === 'DARK' || (uiState.theme === 'SYSTEM' && prefersDark)
    document.documentElement.classList.toggle('dark', dark)
  }, [uiState.theme])

  // Refetch on mount to pick up changes made in another tab or since the page was
  // server-rendered. The Inertia props are a snapshot; GraphQL is the source of truth.
  useEffect(() => {
    const controller = new AbortController()

    graphql<DashboardQueryResult, { id: string }>(DASHBOARD_QUERY, { id: dashboardId }, {
      operationName: 'Dashboard',
      signal: controller.signal,
    })
      .then((data) => {
        setUiState(data.dashboard.uiState)
        confirmedState.current = data.dashboard.uiState
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Non-fatal: the Inertia snapshot is already rendered, so the page stays usable.
        logger.warn('frontend.dashboard_refetch_failed', {
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      })

    return () => controller.abort()
  }, [dashboardId])

  /**
   * Optimistic update with rollback.
   *
   * 1. Apply the change locally so the UI responds immediately.
   * 2. Send the mutation.
   * 3. On success, adopt the server's authoritative response — not the optimistic guess,
   *    because the server may normalize or reject parts of it.
   * 4. On failure, roll back to the last confirmed state and surface the error.
   *
   * Rolling back to `confirmedState` rather than to the pre-change value matters when
   * changes are made in quick succession: the last *server-confirmed* state is the only
   * value known to be real.
   */
  const applyChange = useCallback(
    async (changes: Partial<UiState>, operationLabel: string) => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller

      const optimistic = { ...uiState, ...changes }
      setUiState(optimistic)
      setError(null)
      setSaving(true)

      try {
        const data = await graphql<UpdateStateResult, { dashboardId: string; uiState: Partial<UiState> }>(
          UPDATE_STATE_MUTATION,
          { dashboardId, uiState: changes },
          { operationName: 'UpdateDashboardState', signal: controller.signal },
        )

        const confirmed = data.updateDashboardState.dashboard.uiState
        setUiState(confirmed)
        confirmedState.current = confirmed
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return

        setUiState(confirmedState.current)

        if (err instanceof GraphQLRequestError && err.isUnauthenticated) {
          // The session is gone; a full visit lets Rails redirect to the login page.
          router.visit('/login')
          return
        }

        setError(err instanceof Error ? err.message : 'Could not save your change.')
        logger.warn('frontend.dashboard_update_failed', {
          operationLabel,
          code: err instanceof GraphQLRequestError ? err.code : undefined,
        })
      } finally {
        setSaving(false)
      }
    },
    [dashboardId, uiState],
  )

  const toggleWidget = (widget: string) => {
    const visible = uiState.visibleWidgets.includes(widget)
    const next = visible
      ? uiState.visibleWidgets.filter((w) => w !== widget)
      : [...uiState.visibleWidgets, widget]

    void applyChange({ visibleWidgets: next }, `widget:${widget}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Head title="Dashboard" />

      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {currentUser ? currentUser.name : 'Not signed in'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Reflects in-flight saves without blocking interaction. Disabling the
                controls would defeat the point of an optimistic UI. */}
            <span
              aria-live="polite"
              className={`text-xs ${saving ? 'text-slate-500 dark:text-slate-400' : 'text-transparent'}`}
            >
              Saving…
            </span>
            {currentUser?.avatarUrl && (
              <img src={currentUser.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
            )}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="font-medium underline">
              Dismiss
            </button>
          </div>
        )}

        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Preferences
          </h2>

          <div className="mt-4 flex flex-wrap gap-8">
            <Fieldset label="Theme">
              {THEMES.map((theme) => (
                <Choice
                  key={theme}
                  label={theme.toLowerCase()}
                  selected={uiState.theme === theme}
                  onClick={() => void applyChange({ theme }, `theme:${theme}`)}
                />
              ))}
            </Fieldset>

            <Fieldset label="Layout">
              {LAYOUTS.map((layout) => (
                <Choice
                  key={layout}
                  label={layout.toLowerCase()}
                  selected={uiState.layout === layout}
                  onClick={() => void applyChange({ layout }, `layout:${layout}`)}
                />
              ))}
            </Fieldset>

            <Fieldset label="Widgets">
              {ALL_WIDGETS.map((widget) => (
                <Choice
                  key={widget}
                  label={widget}
                  selected={uiState.visibleWidgets.includes(widget)}
                  onClick={() => toggleWidget(widget)}
                />
              ))}
            </Fieldset>
          </div>
        </section>

        <section
          className={
            uiState.layout === 'GRID'
              ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
              : 'flex flex-col gap-4'
          }
        >
          {uiState.visibleWidgets.map((widget) => (
            <Widget key={widget} name={widget} settings={uiState.widgetSettings[widget]} />
          ))}

          {uiState.visibleWidgets.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No widgets are visible. Enable one above.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}

/**
 * Sign-out, demonstrating Inertia v3's `useHttp`.
 *
 * `useHttp` is the right tool when a request is a *server action* that should participate
 * in Inertia's lifecycle: it tracks `processing`, exposes server-side validation errors in
 * `errors`, and follows the redirect Rails responds with as a page visit.
 *
 * Contrast with the GraphQL client above: that is for client state, returns data rather
 * than a redirect, and must never touch history. Same page, two transports, chosen by what
 * the request *is* rather than by preference.
 *
 * DELETE because Devise's sign_out_via is :delete, which stops a prefetched link or an
 * <img> tag from ending someone's session.
 */
function SignOutButton() {
  const { processing, submit } = useHttp('delete', '/users/sign_out', {})

  return (
    <button
      type="button"
      disabled={processing}
      onClick={() => void submit()}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {processing ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

function Fieldset({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <div className="mt-2 flex gap-2">{children}</div>
    </div>
  )
}

function Choice({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
        selected
          ? 'bg-brand-600 text-white'
          : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  )
}

function Widget({ name, settings }: { name: string; settings: Record<string, unknown> | undefined }) {
  const entries = Object.entries(settings ?? {})

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-semibold capitalize text-slate-900 dark:text-slate-100">{name}</h3>

      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No settings</p>
      ) : (
        <dl className="mt-3 space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 text-xs">
              <dt className="text-slate-500 dark:text-slate-400">{key}</dt>
              {/* widgetSettings is deliberately untyped, so values are stringified rather
                  than rendered directly — React throws on an object child. */}
              <dd className="font-mono text-slate-700 dark:text-slate-300">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}
