# frozen_string_literal: true

module Mutations
  class UpsertContentBlock < BaseDocumentationMutation
    description <<~DESC
      Create or update one content block on a node.

      One mutation for both, because the editor does not distinguish them: adding a
      Markdown block and then typing into it is a create followed by many updates, and the
      client should not need two code paths and two optimistic strategies for one gesture.
    DESC

    argument :node_id, ID, description: "The node the block belongs to."
    argument :block_id, ID, required: false,
             description: "Omit to append a new block; supply it to update an existing one."
    argument :block_type, Types::ContentBlockTypeEnum, required: false,
             description: "Required when creating. On an update, changes the block's type."
    argument :data, GraphQL::Types::JSON, required: false,
             description: "The payload. Validated against the shape declared for `blockType`."
    argument :position, Integer, required: false,
             description: "Insert at this index, shifting the blocks below it down."

    field :content_block, Types::ContentBlockType, null: true,
          description: "The created or updated block."
    field :node, Types::NodeType, null: true,
          description: "The owning node, so the client can re-read its blocks in order."

    def resolve(node_id:, **attributes)
      node = authorize_within_space!(Node.find_by(id: node_id), :write)

      block = Documentation::UpsertContentBlock.call(
        node: node,
        block_id: attributes[:block_id],
        block_type: attributes[:block_type],
        data: attributes[:data],
        position: attributes[:position],
        actor: current_user,
        request_id: context[:request_id]
      )

      # The node is returned alongside the block because an insert renumbers its
      # siblings. Without it the client would hold stale positions and its next insert
      # would land in the wrong place.
      { content_block: block, node: node.reload }
    end
  end
end
