import type { SpaceRole } from '@/types'

/**
 * What each role may do, on the client's side of the boundary.
 *
 * A deliberate duplicate of DocumentationSpace#permits? on the server, and the only
 * honest way to describe it: the server decides, and this decides what to *offer*.
 * Hiding a control the server would refuse is a courtesy to the user; showing one it
 * would allow is a bug. Neither direction is a security question, because the server
 * never consults this.
 *
 * Kept as one ordered scale rather than a set of booleans per role, so a new role is a
 * position in the list rather than an edit to every predicate.
 */
const RANK: Record<SpaceRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
  OWNER: 3,
}

function atLeast(role: SpaceRole | null | undefined, minimum: SpaceRole): boolean {
  if (!role) return false

  return RANK[role] >= RANK[minimum]
}

/** May change the graph. There is no weaker form of writing: an edit lands or is refused. */
export function canEdit(role: SpaceRole | null | undefined): boolean {
  return atLeast(role, 'EDITOR')
}

/** May manage who else has access. */
export function canAdminister(role: SpaceRole | null | undefined): boolean {
  return atLeast(role, 'ADMIN')
}

export const ROLE_LABELS: Record<SpaceRole, string> = {
  VIEWER: 'Viewer',
  EDITOR: 'Editor',
  ADMIN: 'Admin',
  OWNER: 'Owner',
}

export const ROLE_DESCRIPTIONS: Record<SpaceRole, string> = {
  VIEWER: 'Can read everything. Cannot change anything.',
  EDITOR: 'Can change the graph.',
  ADMIN: 'Can edit and manage who else has access.',
  OWNER: 'Created the space. Cannot be removed.',
}

/** The roles that can actually be granted. Ownership is not one of them. */
export const ASSIGNABLE_ROLES: SpaceRole[] = ['VIEWER', 'EDITOR', 'ADMIN']
