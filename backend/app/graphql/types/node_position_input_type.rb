# frozen_string_literal: true

module Types
  # Exposed as `NodePositionInput`.
  #
  # One entry per node in a `moveNodes` batch. A drag can move a whole selection, and the
  # client coalesces the stream of positions a gesture produces into one request per
  # debounce window -- so this is a list, not a single pair of coordinates.
  class NodePositionInputType < Types::BaseInputObject
    graphql_name "NodePositionInput"
    description "A node's new position."

    argument :node_id, ID, description: "The node to move."
    argument :x, Float, description: "New x coordinate."
    argument :y, Float, description: "New y coordinate."
    argument :z, Float, required: false, description: "New depth. Defaults to 0 when omitted."
  end
end
