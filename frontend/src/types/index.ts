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
  /**
   * Fresh authenticity token for the current session. Native forms must use this (or
   * the meta tag after CsrfSync) rather than a token captured on a previous visit.
   */
  csrfToken?: string
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

/* ---------------------------------------------------------------------------
 * Documentation graph
 *
 * Mirrors the GraphQL types by hand, which is the same trade the dashboard types make:
 * no codegen step, at the cost of keeping these in step with the schema. The backend
 * serializes the Inertia props in exactly this shape too (see
 * DocumentationSpacesController), so a page renders from either source without a
 * conversion layer.
 * ------------------------------------------------------------------------- */

/**
 * Matches the GraphQL `ContentBlockType` enum, SCREAMING_CASE on the wire.
 *
 * A closed union because the server validates each payload against a declared shape per
 * type and the frontend has one renderer per type. Node types and relationship verbs are
 * plain strings by contrast -- those sets are open by design.
 */
export type ContentBlockKind =
  | 'TEXT'
  | 'MARKDOWN'
  | 'JSON'
  | 'TABLE'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'URL'
  | 'DROPDOWN'
  | 'CODE'
  | 'DIAGRAM'
  | 'EMBED'
  | 'NODE_REFERENCE'

/**
 * A block's payload.
 *
 * Deliberately `unknown` per key rather than a discriminated union of twelve payload
 * shapes. The server is the validator, and the renderer for each type narrows what it
 * needs at the point of use -- so a block that arrives with a missing field renders a
 * fallback instead of crashing the canvas, which a type assertion here would not give us.
 */
export type ContentBlockData = Record<string, unknown>

export interface ContentBlock {
  id: string
  blockType: ContentBlockKind
  position: number
  data: ContentBlockData
  preview?: string
}

export interface SpatialPosition {
  x: number
  y: number
  /** Persisted from the first version. The 2.5D renderer uses it for stacking order. */
  z: number
}

export interface SpatialSize {
  width: number
  height: number
  depth: number
}

export interface DocumentationNode {
  id: string
  title: string
  summary: string | null
  position: SpatialPosition
  size: SpatialSize
  metadata: Record<string, unknown>
  /**
   * How many nodes this one contains, via `contains` edges.
   *
   * Present on every node the canvas draws, because it decides whether a card can be
   * opened. Counting client-side is not an option: the canvas holds a slice of the
   * graph, so a node's children are usually not in it.
   */
  childCount?: number
  /**
   * The node that contains this one, or null at the top of the space.
   *
   * Requested for the neighbours drawn around a level, because opening one means going
   * to where it actually lives -- a node is only ever drawn among its siblings.
   */
  parentNodeId?: string | null
  /**
   * Every node that contains this one: usually one, sometimes none, occasionally several.
   *
   * Drives the up-a-level control on a card, which has to offer a choice when a node is
   * filed in more than one place. Each entry carries its own parent, because going to a
   * parent means opening the level *it* lives on.
   */
  parents?: NodeParent[]
  /**
   * Absent on the canvas and present in the inspector.
   *
   * The graph snapshot omits content so first paint is proportional to what is on screen
   * rather than to how much has been written; the inspector fetches the selected node's
   * blocks when it opens.
   */
  contentBlocks?: ContentBlock[]
  outgoingRelationships?: NodeRelationship[]
  incomingRelationships?: NodeRelationship[]
}

/** A containing node, as much of it as a card needs to name it and navigate to it. */
export interface NodeParent {
  id: string
  title: string
  parentNodeId: string | null
}

/** An edge that a deletion would remove, said as a sentence rather than as a count. */
export interface AffectedRelationship {
  id: string
  relationshipType: string
  sourceTitle: string
  targetTitle: string
}

/** What deleting a node would take with it, read before asking anyone to confirm. */
export interface DeletionImpact {
  node: Pick<DocumentationNode, 'id' | 'title'>
  /** Nodes inside it that would cease to exist, nearest first. */
  descendants: Pick<DocumentationNode, 'id' | 'title'>[]
  /** Nodes inside it that also live elsewhere, and so survive either way. */
  retained: Pick<DocumentationNode, 'id' | 'title'>[]
  /** Every edge touching the node itself. These go whichever option is taken. */
  relationships: AffectedRelationship[]
  relationshipCount: number
  /** Further edges only a cascading delete would remove. */
  descendantRelationshipCount: number
  blockCount: number
  descendantBlockCount: number
}

export interface NodeRelationship {
  id: string
  /** The verb: `contains`, `depends_on`, `calls`, `writes_to`, or a team's own. */
  relationshipType: string
  sourceNodeId: string
  targetNodeId: string
  metadata: Record<string, unknown>
  sourceNode?: Pick<DocumentationNode, 'id' | 'title'>
  targetNode?: Pick<DocumentationNode, 'id' | 'title'>
}

export interface SpaceGraph {
  nodes: DocumentationNode[]
  relationships: NodeRelationship[]
  /**
   * Nodes on other levels that something here connects to.
   *
   * Not contents of this level and never drawn as such: the canvas shows them faintly,
   * as the far end of an edge that leaves the level, and clicking one navigates to it.
   */
  neighbors?: DocumentationNode[]
  /** How many nodes matched the filter, ignoring the limit. */
  nodeCount: number
  relationshipCount: number
  /** True when the server returned fewer nodes than matched. The UI must say so. */
  truncated: boolean
  /**
   * The node the canvas has descended into, if any.
   *
   * Null at the top of a space. When set, `nodes` are the things it contains rather than
   * a slice of the whole space -- the folder reading of the graph.
   */
  focusNode?: DocumentationNode | null
  /** The containment path down to `focusNode`, outermost first. The breadcrumb. */
  trail?: DocumentationNode[]
}

/**
 * What someone may do in a space.
 *
 * Ordered by privilege, and the order matters to `canEdit` and friends in
 * `@/features/documentation/roles`.
 */
export type SpaceRole = 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER'

export interface SpaceMembership {
  id: string
  role: SpaceRole
  /** True until the invited address has signed in and claimed the invitation. */
  pending: boolean
  name: string
  email: string
  userId: string | null
}

export interface DocumentationSpace {
  /** The public UUID, not the database id. This is what URLs and mutations use. */
  id: string
  name: string
  slug: string
  description: string | null
  settings: Record<string, unknown>
  nodeCount?: number
  relationshipCount?: number
  /** What the signed-in user may do here. Decides which controls are offered. */
  viewerRole?: SpaceRole
  /** Everyone with access, including the owner. Present for anyone who can see the space. */
  memberCount?: number
  /** Populated only for admins: who may read a space is not public within it. */
  memberships?: SpaceMembership[]
}

export interface SearchResult {
  node: Pick<DocumentationNode, 'id' | 'title'>
  snippet: string
  rank: number
}

export interface DocumentationSpaceIndexPageProps {
  spaces: DocumentationSpace[]
}

/** Who the signed-in user is on the presence layer. Everyone else arrives over the socket. */
export interface Collaborator {
  id: string
  name: string
  colorSeed: number
}

export interface DocumentationSpacePageProps {
  space: DocumentationSpace
  initialGraph: SpaceGraph
  /** Server-owned vocabularies, sent so the client does not keep a copy that can drift. */
  relationshipTypes: string[]
  blockTypes: ContentBlockKind[]
  collaborator: Collaborator
  /**
   * What this user may do here.
   *
   * Used to decide which controls to render. It is not the enforcement -- the server
   * re-derives the same answer for every mutation -- so treating a missing button as a
   * security boundary would be a mistake in either direction.
   */
  viewerRole: SpaceRole
}
