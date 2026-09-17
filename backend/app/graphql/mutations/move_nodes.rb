# frozen_string_literal: true

module Mutations
  # Persists positions after a drag.
  #
  # Plural, and that is the whole design. A drag moves however many nodes are selected and
  # produces a position stream at pointer frequency; the client applies it optimistically
  # and sends one batched request per debounce window. One mutation per node would turn a
  # single gesture into dozens of round trips, each with its own transaction.
  class MoveNodes < BaseDocumentationMutation
    description "Persist new positions for one or more nodes in a space."

    argument :space_id, ID, description: "The space the nodes belong to."
    argument :positions, [ Types::NodePositionInputType ],
             description: "One entry per moved node. Ids outside this space are ignored."

    field :nodes, [ Types::NodeType ], null: true,
          description: "The nodes that were actually moved."

    def resolve(space_id:, positions:)
      # Layout is a change like any other: a role that cannot edit a title has no
      # business rearranging the diagram everyone reads.
      space = authorize_space_by_public_id!(space_id, :write)

      coordinates = positions.map { |position|
        { id: position[:node_id], x: position[:x], y: position[:y], z: position[:z] || 0.0 }
      }

      moved = Documentation::MoveNodes.call(
        space: space,
        positions: coordinates,
        actor: current_user,
        request_id: context[:request_id]
      )

      { nodes: moved }
    end
  end
end
