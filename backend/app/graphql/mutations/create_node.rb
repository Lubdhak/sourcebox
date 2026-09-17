# frozen_string_literal: true

module Mutations
  class CreateNode < BaseDocumentationMutation
    description "Add a node to a space, optionally with content and a parent edge."

    argument :space_id, ID, description: "The space to add the node to."
    argument :title, String, description: "What the node is called."
    argument :node_type, String, required: false,
             description: "What kind of thing it represents. Free-form; defaults to `concept`."
    argument :summary, String, required: false, description: "One-line description."
    argument :x, Float, required: false, description: "Initial x coordinate."
    argument :y, Float, required: false, description: "Initial y coordinate."
    argument :z, Float, required: false, description: "Initial depth."
    argument :layer_id, ID, required: false,
             description: <<~DESC
               The depth to place it on. Defaults to one rung below the parent's, or the
               first rung for the root of the space, creating that rung if it is not there
               yet. An explicit value always wins: containment and depth are related by
               default, not welded together.
             DESC
    argument :metadata, GraphQL::Types::JSON, required: false, description: "Open-ended annotation."
    argument :blocks, [ Types::ContentBlockInputType ], required: false,
             description: "Content blocks to create with the node, in order."
    argument :parent_node_id, ID, required: false,
             description: <<~DESC
               Create a `contains` edge from this node to the new one.

               Authoring a node and placing it in the graph is one gesture, so it is one
               mutation and one transaction: a failure must not leave a titled node that
               belongs nowhere.

               Omitting it does not mean "no parent": the space's root node adopts the
               new node, so a space stays one connected graph. Only the first node in an
               empty space has no parent, and that node becomes the root. Read the
               returned node's `parents` to find out where it actually landed -- it may
               not be the level the client was showing.
             DESC

    field :node, Types::NodeType, null: true,
          description: "The new node."

    def resolve(space_id:, title:, **attributes)
      space = authorize_space_by_public_id!(space_id, :write)

      node = Documentation::CreateNode.call(
        space: space,
        title: title,
        node_type: attributes[:node_type],
        summary: attributes[:summary],
        x: attributes[:x] || 0.0,
        y: attributes[:y] || 0.0,
        z: attributes[:z] || 0.0,
        layer_id: attributes[:layer_id],
        metadata: attributes[:metadata] || {},
        blocks: Array(attributes[:blocks]).map(&:to_h),
        parent_node_id: attributes[:parent_node_id],
        actor: current_user,
        request_id: context[:request_id]
      )

      { node: node }
    end
  end
end
