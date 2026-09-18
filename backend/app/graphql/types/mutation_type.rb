# frozen_string_literal: true

module Types
  class MutationType < Types::BaseObject
    description "Root mutation."

    # --- Documentation graph ---------------------------------------------
    #
    # Every structural change to a space goes through exactly one of these, and each one
    # delegates to exactly one domain operation that emits exactly one event. That is what
    # makes future versioning a matter of consuming the event stream rather than rewriting
    # this layer.
    field :create_documentation_space, mutation: Mutations::CreateDocumentationSpace
    field :create_node, mutation: Mutations::CreateNode
    field :update_node, mutation: Mutations::UpdateNode
    field :move_nodes, mutation: Mutations::MoveNodes
    field :reparent_node, mutation: Mutations::ReparentNode
    field :clone_node, mutation: Mutations::CloneNode
    # One deletion entry point for one node or many. See Mutations::DeleteNodes.
    field :delete_nodes, mutation: Mutations::DeleteNodes
    field :create_relationship, mutation: Mutations::CreateRelationship
    field :delete_relationship, mutation: Mutations::DeleteRelationship
    field :upsert_content_block, mutation: Mutations::UpsertContentBlock
    field :delete_content_block, mutation: Mutations::DeleteContentBlock

    # Who may read and write this space.
    field :share_space, mutation: Mutations::ShareSpace
    field :change_member_role, mutation: Mutations::ChangeMemberRole
    field :revoke_space_access, mutation: Mutations::RevokeSpaceAccess
  end
end
