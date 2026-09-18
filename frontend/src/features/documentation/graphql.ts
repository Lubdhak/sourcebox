import { graphql } from '@/lib/graphql'
import type {
  ContentBlock,
  ContentBlockData,
  ContentBlockKind,
  DeleteNodesResult,
  DeletionPolicy,
  DocumentationNode,
  DocumentationSpace,
  NodeDeletionImpact,
  NodeRelationship,
  SearchResult,
  SpaceGraph,
  SpaceMembership,
  SpaceRole,
} from '@/types'

/**
 * Every documentation operation, in one place.
 *
 * The dashboard page keeps its two operations inline, which is right for two. A canvas
 * has ten, several pages use the same ones, and the tests need to assert which one was
 * sent -- so they live here, as named exports, with a typed function per operation. The
 * transport is still `lib/graphql.ts`; nothing here knows about fetch, CSRF or errors.
 */

/**
 * The fields the canvas needs to draw a node. Content is deliberately absent: see
 * NODE_DETAIL_QUERY.
 */
const NODE_FIELDS = /* GraphQL */ `
  fragment NodeFields on Node {
    id
    title
    summary
    position {
      x
      y
      z
    }
    size {
      width
      height
      depth
    }
    metadata
    childCount
    parents {
      id
      title
      parentNodeId
    }
  }
`

const RELATIONSHIP_FIELDS = /* GraphQL */ `
  fragment RelationshipFields on NodeRelationship {
    id
    relationshipType
    sourceNodeId
    targetNodeId
    metadata
  }
`

const BLOCK_FIELDS = /* GraphQL */ `
  fragment BlockFields on ContentBlock {
    id
    blockType
    position
    data
  }
`

export const SPACE_GRAPH_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  ${RELATIONSHIP_FIELDS}
  query SpaceGraph($id: ID!, $limit: Int, $focusNodeId: ID) {
    documentationSpace(id: $id) {
      id
      name
      slug
      description
      settings
      graph(limit: $limit, focusNodeId: $focusNodeId) {
        nodeCount
        relationshipCount
        truncated
        nodes {
          ...NodeFields
        }
        relationships {
          ...RelationshipFields
        }
        neighbors {
          ...NodeFields
          parentNodeId
        }
        focusNode {
          ...NodeFields
        }
        trail {
          ...NodeFields
        }
      }
    }
  }
`

/**
 * One node with everything the inspector shows.
 *
 * Split from the graph query on purpose. Content blocks are a page of documentation per
 * node, so folding them into the canvas query would make first paint proportional to how
 * much has been written rather than to how much is on screen.
 */
export const NODE_DETAIL_QUERY = /* GraphQL */ `
  ${NODE_FIELDS}
  ${BLOCK_FIELDS}
  query NodeDetail($id: ID!) {
    node(id: $id) {
      ...NodeFields
      contentBlocks {
        ...BlockFields
      }
      outgoingRelationships {
        id
        relationshipType
        sourceNodeId
        targetNodeId
        targetNode {
          id
          title
        }
      }
      incomingRelationships {
        id
        relationshipType
        sourceNodeId
        targetNodeId
        sourceNode {
          id
          title
        }
      }
    }
  }
`

export const SEARCH_QUERY = /* GraphQL */ `
  query SearchDocumentation($spaceId: ID!, $query: String!) {
    searchDocumentation(spaceId: $spaceId, query: $query) {
      rank
      snippet
      node {
        id
        title
      }
    }
  }
`

export const CREATE_SPACE_MUTATION = /* GraphQL */ `
  mutation CreateDocumentationSpace($name: String!, $description: String) {
    createDocumentationSpace(input: { name: $name, description: $description }) {
      documentationSpace {
        id
        name
        slug
      }
    }
  }
`

export const CREATE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation CreateNode(
    $spaceId: ID!
    $title: String!
    $x: Float
    $y: Float
    $parentNodeId: ID
  ) {
    createNode(
      input: {
        spaceId: $spaceId
        title: $title
        x: $x
        y: $y
        parentNodeId: $parentNodeId
      }
    ) {
      node {
        ...NodeFields
      }
    }
  }
`

export const UPDATE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation UpdateNode($nodeId: ID!, $title: String, $summary: String) {
    updateNode(
      input: { nodeId: $nodeId, title: $title, summary: $summary }
    ) {
      node {
        ...NodeFields
      }
    }
  }
`

export const MOVE_NODES_MUTATION = /* GraphQL */ `
  mutation MoveNodes($spaceId: ID!, $positions: [NodePositionInput!]!) {
    moveNodes(input: { spaceId: $spaceId, positions: $positions }) {
      nodes {
        id
        position {
          x
          y
          z
        }
      }
    }
  }
`

/**
 * The deletion impact, as returned by both the query and the conflict branch of the
 * mutation. Shared so the two cannot drift.
 */
const DELETION_IMPACT_FIELDS = /* GraphQL */ `
  fragment DeletionImpactFields on NodeDeletionImpact {
    digest
    selected {
      id
      title
      reason
    }
    orphans {
      id
      title
      reason
    }
    retained {
      id
      title
      reason
    }
    references {
      id
      kind
      sourceId
      sourceTitle
      targetId
      targetTitle
    }
    selectedCount
    orphanCount
    referenceCount
    additionalDeleteCount
    deleteCount
    affectedCount
    blockCount
  }
`

export const DELETION_IMPACT_QUERY = /* GraphQL */ `
  ${DELETION_IMPACT_FIELDS}
  query NodesDeletionImpact(
    $nodeIds: [ID!]!
    $deletionMode: DeletionMode
    $referencePolicy: ReferencePolicy
    $orphanPolicy: OrphanPolicy
  ) {
    nodesDeletionImpact(
      nodeIds: $nodeIds
      deletionMode: $deletionMode
      referencePolicy: $referencePolicy
      orphanPolicy: $orphanPolicy
    ) {
      ...DeletionImpactFields
    }
  }
`

export const DELETE_NODES_MUTATION = /* GraphQL */ `
  ${DELETION_IMPACT_FIELDS}
  mutation DeleteNodes(
    $nodeIds: [ID!]!
    $deletionMode: DeletionMode
    $referencePolicy: ReferencePolicy
    $orphanPolicy: OrphanPolicy
    $expectedDigest: String
  ) {
    deleteNodes(
      input: {
        nodeIds: $nodeIds
        deletionMode: $deletionMode
        referencePolicy: $referencePolicy
        orphanPolicy: $orphanPolicy
        expectedDigest: $expectedDigest
      }
    ) {
      deletedNodeIds
      changed
      impact {
        ...DeletionImpactFields
      }
    }
  }
`

export const CREATE_RELATIONSHIP_MUTATION = /* GraphQL */ `
  ${RELATIONSHIP_FIELDS}
  mutation CreateRelationship($spaceId: ID!, $sourceNodeId: ID!, $targetNodeId: ID!, $relationshipType: String!) {
    createRelationship(
      input: {
        spaceId: $spaceId
        sourceNodeId: $sourceNodeId
        targetNodeId: $targetNodeId
        relationshipType: $relationshipType
      }
    ) {
      relationship {
        ...RelationshipFields
      }
    }
  }
`

export const DELETE_RELATIONSHIP_MUTATION = /* GraphQL */ `
  mutation DeleteRelationship($relationshipId: ID!) {
    deleteRelationship(input: { relationshipId: $relationshipId }) {
      deletedRelationshipId
    }
  }
`

export const UPSERT_BLOCK_MUTATION = /* GraphQL */ `
  ${BLOCK_FIELDS}
  mutation UpsertContentBlock(
    $nodeId: ID!
    $blockId: ID
    $blockType: ContentBlockType
    $data: JSON
    $position: Int
  ) {
    upsertContentBlock(
      input: { nodeId: $nodeId, blockId: $blockId, blockType: $blockType, data: $data, position: $position }
    ) {
      contentBlock {
        ...BlockFields
      }
      node {
        id
        contentBlocks {
          ...BlockFields
        }
      }
    }
  }
`

export const DELETE_BLOCK_MUTATION = /* GraphQL */ `
  ${BLOCK_FIELDS}
  mutation DeleteContentBlock($blockId: ID!) {
    deleteContentBlock(input: { blockId: $blockId }) {
      deletedBlockId
      node {
        id
        contentBlocks {
          ...BlockFields
        }
      }
    }
  }
`

/* --- Typed callers ------------------------------------------------------- */

interface RequestOptions {
  signal?: AbortSignal
}

export type SpaceWithGraph = DocumentationSpace & { graph: SpaceGraph }

export async function fetchSpaceGraph(
  variables: { id: string; limit?: number; focusNodeId?: string | null },
  options: RequestOptions = {},
): Promise<SpaceWithGraph> {
  const data = await graphql<{ documentationSpace: SpaceWithGraph }, typeof variables>(
    SPACE_GRAPH_QUERY,
    variables,
    { operationName: 'SpaceGraph', ...options },
  )

  return data.documentationSpace
}

export type NodeDetail = DocumentationNode & {
  contentBlocks: ContentBlock[]
  outgoingRelationships: NodeRelationship[]
  incomingRelationships: NodeRelationship[]
}

export async function fetchNodeDetail(id: string, options: RequestOptions = {}): Promise<NodeDetail> {
  const data = await graphql<{ node: NodeDetail }, { id: string }>(NODE_DETAIL_QUERY, { id }, {
    operationName: 'NodeDetail',
    ...options,
  })

  return data.node
}

export async function searchDocumentation(
  variables: { spaceId: string; query: string },
  options: RequestOptions = {},
): Promise<SearchResult[]> {
  const data = await graphql<{ searchDocumentation: SearchResult[] }, typeof variables>(
    SEARCH_QUERY,
    variables,
    { operationName: 'SearchDocumentation', ...options },
  )

  return data.searchDocumentation
}

export async function createSpace(variables: { name: string; description?: string }): Promise<DocumentationSpace> {
  const data = await graphql<
    { createDocumentationSpace: { documentationSpace: DocumentationSpace } },
    typeof variables
  >(CREATE_SPACE_MUTATION, variables, { operationName: 'CreateDocumentationSpace' })

  return data.createDocumentationSpace.documentationSpace
}

export async function createNode(variables: {
  spaceId: string
  title: string
  x?: number
  y?: number
  parentNodeId?: string | null
}): Promise<DocumentationNode> {
  const data = await graphql<{ createNode: { node: DocumentationNode | null } }, typeof variables>(
    CREATE_NODE_MUTATION,
    variables,
    { operationName: 'CreateNode' },
  )

  return data.createNode.node!
}

export async function updateNode(variables: {
  nodeId: string
  title?: string
  summary?: string
}): Promise<DocumentationNode> {
  const data = await graphql<{ updateNode: { node: DocumentationNode | null } }, typeof variables>(
    UPDATE_NODE_MUTATION,
    variables,
    { operationName: 'UpdateNode' },
  )

  return data.updateNode.node!
}

export interface NodePositionInput {
  nodeId: string
  x: number
  y: number
  z?: number
}

export async function moveNodes(
  variables: { spaceId: string; positions: NodePositionInput[] },
  options: RequestOptions = {},
): Promise<{ id: string; position: { x: number; y: number; z: number } }[]> {
  const data = await graphql<
    { moveNodes: { nodes: { id: string; position: { x: number; y: number; z: number } }[] | null } },
    typeof variables
  >(MOVE_NODES_MUTATION, variables, { operationName: 'MoveNodes', ...options })

  return data.moveNodes.nodes!
}

export const REPARENT_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation ReparentNode($nodeId: ID!, $newParentId: ID, $fromParentId: ID) {
    reparentNode(input: { nodeId: $nodeId, newParentId: $newParentId, fromParentId: $fromParentId }) {
      node {
        ...NodeFields
      }
    }
  }
`

export async function reparentNode(variables: {
  nodeId: string
  newParentId?: string | null
  fromParentId?: string | null
}): Promise<DocumentationNode> {
  const data = await graphql<{ reparentNode: { node: DocumentationNode | null } }, typeof variables>(
    REPARENT_NODE_MUTATION,
    variables,
    { operationName: 'ReparentNode' },
  )

  return data.reparentNode.node!
}

export const CLONE_NODE_MUTATION = /* GraphQL */ `
  ${NODE_FIELDS}
  mutation CloneNode($nodeId: ID!, $includeChildren: Boolean) {
    cloneNode(input: { nodeId: $nodeId, includeChildren: $includeChildren }) {
      node {
        ...NodeFields
      }
    }
  }
`

export async function cloneNode(nodeId: string, includeChildren = false): Promise<DocumentationNode> {
  const data = await graphql<
    { cloneNode: { node: DocumentationNode | null } },
    { nodeId: string; includeChildren: boolean }
  >(CLONE_NODE_MUTATION, { nodeId, includeChildren }, { operationName: 'CloneNode' })

  return data.cloneNode.node!
}

/**
 * What deleting this selection would do, under this policy.
 *
 * Re-requested whenever a policy option changes, because the answer changes with it.
 * `signal` matters here: the dialog fires one of these per radio click and a slow earlier
 * response must not overwrite a newer one.
 */
export async function fetchNodesDeletionImpact(
  variables: { nodeIds: string[] } & Partial<DeletionPolicy>,
  options: RequestOptions = {},
): Promise<NodeDeletionImpact> {
  const data = await graphql<{ nodesDeletionImpact: NodeDeletionImpact }, typeof variables>(
    DELETION_IMPACT_QUERY,
    variables,
    { ...options, operationName: 'NodesDeletionImpact' },
  )

  return data.nodesDeletionImpact
}

/**
 * Deletes a selection under a policy.
 *
 * `expectedDigest` is the preview the user confirmed. When the server's recalculation no
 * longer matches, it deletes nothing and returns `changed: true` with the fresh impact.
 */
export async function deleteNodes(
  variables: { nodeIds: string[]; expectedDigest?: string } & Partial<DeletionPolicy>,
): Promise<DeleteNodesResult> {
  const data = await graphql<{ deleteNodes: DeleteNodesResult }, typeof variables>(
    DELETE_NODES_MUTATION,
    variables,
    { operationName: 'DeleteNodes' },
  )

  return data.deleteNodes
}

export async function createRelationship(variables: {
  spaceId: string
  sourceNodeId: string
  targetNodeId: string
  relationshipType: string
}): Promise<NodeRelationship> {
  const data = await graphql<{ createRelationship: { relationship: NodeRelationship | null } }, typeof variables>(
    CREATE_RELATIONSHIP_MUTATION,
    variables,
    { operationName: 'CreateRelationship' },
  )

  return data.createRelationship.relationship!
}

export async function deleteRelationship(relationshipId: string): Promise<string> {
  const data = await graphql<
    { deleteRelationship: { deletedRelationshipId: string | null } },
    { relationshipId: string }
  >(DELETE_RELATIONSHIP_MUTATION, { relationshipId }, { operationName: 'DeleteRelationship' })

  return data.deleteRelationship.deletedRelationshipId!
}

export async function upsertContentBlock(variables: {
  nodeId: string
  blockId?: string
  blockType?: ContentBlockKind
  data?: ContentBlockData
  position?: number
}): Promise<{ contentBlock: ContentBlock; blocks: ContentBlock[] }> {
  const data = await graphql<
    {
      upsertContentBlock: {
        contentBlock: ContentBlock | null
        node: { id: string; contentBlocks: ContentBlock[] } | null
      }
    },
    typeof variables
  >(UPSERT_BLOCK_MUTATION, variables, { operationName: 'UpsertContentBlock' })

  const payload = data.upsertContentBlock

  return {
    contentBlock: payload.contentBlock!,
    blocks: payload.node!.contentBlocks,
  }
}

export async function deleteContentBlock(blockId: string): Promise<ContentBlock[]> {
  const data = await graphql<
    { deleteContentBlock: { deletedBlockId: string | null; node: { id: string; contentBlocks: ContentBlock[] } | null } },
    { blockId: string }
  >(DELETE_BLOCK_MUTATION, { blockId }, { operationName: 'DeleteContentBlock' })

  return data.deleteContentBlock.node!.contentBlocks
}

/* --- Sharing and review -------------------------------------------------- */

const MEMBERSHIP_FIELDS = /* GraphQL */ `
  fragment MembershipFields on SpaceMembership {
    id
    role
    pending
    name
    email
    userId
  }
`

export const SHARE_SPACE_MUTATION = /* GraphQL */ `
  ${MEMBERSHIP_FIELDS}
  mutation ShareSpace($spaceId: ID!, $email: String!, $role: SpaceRole!) {
    shareSpace(input: { spaceId: $spaceId, email: $email, role: $role }) {
      memberships {
        ...MembershipFields
      }
    }
  }
`

export const CHANGE_MEMBER_ROLE_MUTATION = /* GraphQL */ `
  ${MEMBERSHIP_FIELDS}
  mutation ChangeMemberRole($membershipId: ID!, $role: SpaceRole!) {
    changeMemberRole(input: { membershipId: $membershipId, role: $role }) {
      membership {
        ...MembershipFields
      }
    }
  }
`

export const REVOKE_ACCESS_MUTATION = /* GraphQL */ `
  mutation RevokeSpaceAccess($membershipId: ID!) {
    revokeSpaceAccess(input: { membershipId: $membershipId }) {
      revokedMembershipId
    }
  }
`

/**
 * Sharing returns the whole list rather than the one membership that changed, because
 * adding somebody who is already there is a role change: the caller cannot tell from
 * its own arguments whether the list grew or an existing row moved.
 */
export async function shareSpace(variables: {
  spaceId: string
  email: string
  role: SpaceRole
}): Promise<SpaceMembership[]> {
  const data = await graphql<{ shareSpace: { memberships: SpaceMembership[] } }, typeof variables>(
    SHARE_SPACE_MUTATION,
    variables,
    { operationName: 'ShareSpace' },
  )

  return data.shareSpace.memberships
}

export async function changeMemberRole(variables: {
  membershipId: string
  role: SpaceRole
}): Promise<SpaceMembership> {
  const data = await graphql<{ changeMemberRole: { membership: SpaceMembership } }, typeof variables>(
    CHANGE_MEMBER_ROLE_MUTATION,
    variables,
    { operationName: 'ChangeMemberRole' },
  )

  return data.changeMemberRole.membership
}

export async function revokeSpaceAccess(membershipId: string): Promise<string> {
  const data = await graphql<
    { revokeSpaceAccess: { revokedMembershipId: string } },
    { membershipId: string }
  >(REVOKE_ACCESS_MUTATION, { membershipId }, { operationName: 'RevokeSpaceAccess' })

  return data.revokeSpaceAccess.revokedMembershipId
}

