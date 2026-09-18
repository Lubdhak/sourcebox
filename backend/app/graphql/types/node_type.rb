# frozen_string_literal: true

module Types
  # Exposed as `Node`.
  class NodeType < Types::BaseObject
    description <<~DESC
      A documentation entity: a product, a service, a table, a team, a business rule --
      anything the user wants to document. Everything in a space is a node.
    DESC

    field :id, ID
    field :title, String
    field :summary, String, null: true

    field :position, Types::SpatialPositionType,
          description: "Where the node sits in space. Persisted server-side; the renderer does not own it."

    field :size, Types::SpatialSizeType,
          description: "Renderer extents, persisted so a resized node keeps its shape."

    field :metadata, GraphQL::Types::JSON,
          description: "Open-ended per-node annotation: owning team, status, external ids, renderer hints."

    # Plain lists rather than connections, which is a deliberate exception to the rule
    # stated in Schema.
    #
    # A connection exists to stop an unbounded result set. These three are bounded by
    # what one node can have: blocks are a hand-authored page of documentation, and edges
    # are how many things one component connects to. Making them connections would add
    # pagination state to every node on a canvas that loads hundreds of them, and would
    # push a single screen past the schema's complexity budget. The bound that matters is
    # on the number of *nodes* returned, and that is enforced by SpaceGraphType.
    field :content_blocks, [ Types::ContentBlockType ],
          description: "The node's documentation, in display order."

    field :outgoing_relationships, [ Types::NodeRelationshipType ],
          description: "Edges where this node is the source."

    field :incoming_relationships, [ Types::NodeRelationshipType ],
          description: "Edges where this node is the target."

    field :child_count, Int,
          description: <<~DESC
            How many nodes this one contains.

            Drives the dive-in affordance: a card with contents can be opened, and the
            canvas descends into it. Counts `contains` edges only, so a node that merely
            calls a dozen services does not pretend to hold them.
          DESC

    field :relationship_count, Int,
          description: <<~DESC
            How many nodes this one is connected to, in either direction and by any
            relationship type.

            Zero is the value the UI reads: a node that nothing contains, that contains
            nothing and that nothing links to cannot be arrived at by navigating, only
            by search, and both the card and the page mark it as such.

            Counted here rather than from the edges a canvas was sent, because a canvas
            gets one level's edges plus a capped sample of the ones leaving it -- from
            which the client cannot tell a node connected to nothing from one whose only
            edge was over that cap.
          DESC

    field :parent_node_id, ID, null: true,
          description: <<~DESC
            The node that contains this one, or null if it sits at the top of the space.

            This is where the canvas has to go to show this node: a node is only drawn
            among its siblings, inside its parent. One parent among possibly several,
            chosen by the same rule as the breadcrumb -- see Loaders::ParentLoader.
          DESC

    field :parents, [ Types::NodeType ],
          description: <<~DESC
            Every node that contains this one.

            Usually one, sometimes none, and occasionally several: a `users` table can sit
            inside both Identity and Billing. The canvas uses it for the up-a-level
            control on each card, which has to offer a choice when there is one.
          DESC

    field :created_at, GraphQL::Types::ISO8601DateTime
    field :updated_at, GraphQL::Types::ISO8601DateTime

    def id
      object.id.to_s
    end

    def child_count
      dataloader.with(Loaders::ChildCountLoader).load(object.id)
    end

    def relationship_count
      dataloader.with(Loaders::RelationshipCountLoader).load(object.id)
    end

    def parent_node_id
      dataloader.with(Loaders::ParentLoader).load(object.id)&.to_s
    end

    def parents
      dataloader.with(Loaders::ParentsLoader).load(object.id)
    end

    # `position` and `size` read their fields straight off the node, so the node is its
    # own `object` for both.
    def position
      object
    end

    def size
      object
    end

    # All three of these are batched. Without the loaders, selecting content and edges for
    # the 200 nodes on screen would be 600 queries; with them it is three.
    def content_blocks
      load_association(Node, :content_blocks)
    end

    def outgoing_relationships
      load_association(Node, :outgoing_relationships)
    end

    def incoming_relationships
      load_association(Node, :incoming_relationships)
    end
  end
end
