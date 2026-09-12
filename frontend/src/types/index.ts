/**
 * Types shared across the frontend.
 *
 * These mirror the GraphQL schema deliberately, and the Inertia props are serialized in
 * the same shape (see DashboardsController#serialize_ui_state). One representation of UI
 * state, whether it arrived from the initial page render or from a GraphQL query.
 */

/** Matches the GraphQL `Theme` enum. Enum values are SCREAMING_CASE on the wire. */
export type Theme = 'LIGHT' | 'DARK' | 'SYSTEM'

/** Matches the GraphQL `Layout` enum. */
export type Layout = 'GRID' | 'LIST'

/**
 * `widgetSettings` is the one genuinely dynamic part of the state, so it is typed as
 * unknown values rather than `any`. Callers must narrow before use, which is the point:
 * this data is round-tripped from the client and is not schema-validated server-side.
 */
export type WidgetSettings = Record<string, Record<string, unknown> | undefined>

export interface UiState {
  theme: Theme
  layout: Layout
  visibleWidgets: string[]
  widgetSettings: WidgetSettings
}

export interface CurrentUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

export interface Dashboard {
  id: string
  uiState: UiState
}

/**
 * Props Rails shares with every page via `inertia_share`.
 *
 * All optional because the controller compacts blank values out of the payload rather
 * than sending nulls.
 */
export interface SharedProps {
  currentUser?: CurrentUser
  flash?: {
    notice?: string
    alert?: string
  }
  /** Correlates a browser-side log line with the server logs for the same request. */
  requestId?: string
}

/**
 * `SharedProps` widened for `usePage`.
 *
 * Inertia declares `usePage<T extends PageProps>` where `PageProps` is
 * `{ [key: string]: unknown }`, so a precise interface cannot be passed directly — it has
 * no index signature and fails the constraint.
 *
 * The widening is deliberately confined to this alias instead of being added to
 * `SharedProps` itself. An index signature on `SharedProps` would make every misspelled
 * property resolve to `unknown` rather than error, everywhere the type is used.
 */
export type InertiaSharedProps = SharedProps & Record<string, unknown>

export interface DashboardPageProps {
  dashboardId: string
  initialUiState: UiState
}

export interface LoginPageProps {
  googleAuthPath: string
  /** Development only: Google OAuth needs real credentials a fresh checkout lacks. */
  allowPasswordSignIn: boolean
  error?: string
}
