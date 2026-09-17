# frozen_string_literal: true

module Mutations
  class CreateRelationship < BaseDocumentationMutation
    description <<~DESC
      Connect two nodes with a typed, directed edge.

      Idempotent: re-sending an edge that already exists returns it rather than failing,
      because an optimistic client retries readily and a unique index would otherwise turn
      a retry into an error the user has to understand.
    DESC

    argument :space_id, ID, description: "The space both nodes belong to."
    argument :source_node_id, ID, description: "The node the edge points from."
    argument :target_node_id, ID, description: "The node the edge points to."
    argument :relationship_type, String,
             description: "The verb, for example `depends_on`. Lowercase letters, numbers and underscores."
    argument :metadata, GraphQL::Types::JSON, required: false, description: "Open-ended per-edge annotation."

    field :relationship, Types::NodeRelationshipType, null: true,
          description: "The edge."

    def resolve(space_id:, source_node_id:, target_node_id:, relationship_type:, metadata: nil)
      # Authorizing the space is sufficient, because the operation resolves both endpoints
      # *through* that space. An id belonging to another user's node is simply not found
      # there, so an edge can never span two spaces.
      space = authorize_space_by_public_id!(space_id, :write)

      relationship = Documentation::CreateRelationship.call(
        space: space,
        source_node_id: source_node_id,
        target_node_id: target_node_id,
        relationship_type: relationship_type,
        metadata: metadata || {},
        actor: current_user,
        request_id: context[:request_id]
      )

      { relationship: relationship }
    end

    private

    # Titles rather than ids, because the reviewer is being asked about the documentation
    # and "connect 41 to 58" is not a question anyone can answer.
    def relationship_summary(space, source_id, target_id, verb)
      titles = space.nodes.where(id: [ source_id, target_id ]).pluck(:id, :title).to_h

      "Connect “#{titles[source_id.to_i] || source_id}” #{verb.tr('_', ' ')} " \
        "“#{titles[target_id.to_i] || target_id}”"
    end
  end
end
