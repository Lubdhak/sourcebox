# frozen_string_literal: true

module Types
  # Exposed as `SpaceGraph`.
  #
  # Nodes and edges arrive together and in one bounded batch rather than as two
  # connections, because a graph cannot be paginated coherently: an edge whose other
  # endpoint fell on the next page has nothing to attach to. See
  # Documentation::GraphSnapshot for the reasoning and the bound.
  class SpaceGraphType < Types::BaseObject
    description "A bounded, internally consistent slice of a space's graph."

    field :nodes, [ Types::NodeType ],
          description: "The nodes in this slice."

    field :relationships, [ Types::NodeRelationshipType ],
          description: "Edges whose source and target are both present in `nodes`."

    field :neighbors, [ Types::NodeType ],
          description: <<~DESC
            Nodes elsewhere in the space that something in `nodes` connects to.

            The canvas shows one level at a time, but relationships cross levels: a
            module deep inside one service may call another service outright. Those edges
            are in `relationships` and their far ends are here, so the client can draw
            them as context -- faint, and a way to navigate to where they really live --
            without mistaking them for contents of the current level.

            Containment edges are excluded, since every node's parent and children are
            off-level by definition and following them would undo the scoping.
          DESC

    field :node_count, Integer,
          description: "How many nodes match the filter, ignoring the limit."

    field :relationship_count, Integer,
          description: "How many edges the space contains in total."

    field :truncated, Boolean,
          description: <<~DESC
            True when the filter matched more nodes than were returned.

            The client should say so rather than present a partial graph as the whole
            thing. Narrow by layer or viewport to get the rest.
          DESC

    field :focus_node, Types::NodeType, null: true,
          description: <<~DESC
            The node the canvas has descended into, if any.

            Null when `nodes` is a slice of the whole space. Non-null when the client
            passed `focusNodeId`, in which case `nodes` are the things this node
            contains.
          DESC

    field :trail, [ Types::NodeType ],
          description: <<~DESC
            The containment path down to `focusNode`, outermost first, excluding it.

            This is the breadcrumb. A node can be contained by several parents, so the
            path is one deterministic choice among several -- see
            Documentation::AncestorTrail.
          DESC
  end
end
