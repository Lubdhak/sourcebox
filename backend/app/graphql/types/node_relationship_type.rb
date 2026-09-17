# frozen_string_literal: true

module Types
  # Exposed as `NodeRelationship`.
  class NodeRelationshipType < Types::BaseObject
    description <<~DESC
      A directed, typed edge between two nodes: `Frontend calls API`,
      `API writes_to Database`, `Payments depends_on Authentication`.
    DESC

    field :id, ID
    field :relationship_type, String,
          description: <<~DESC
            The verb, for example `contains`, `depends_on`, `calls`, `writes_to`.

            A free-form lowercase identifier rather than an enum, so a team can use its
            own vocabulary without a schema change. `NodeRelationship::SUGGESTED_TYPES`
            is what the UI offers by default.
          DESC

    # Ids rather than nested nodes as the primary representation.
    #
    # The canvas already holds every node it drew, keyed by id, so resolving the full node
    # on each edge would send the same payload many times over and walk straight into the
    # schema's depth limit on a cyclic graph. `sourceNode` and `targetNode` are available
    # for the cases -- an inspector, a search result -- where only the edge is at hand.
    field :source_node_id, ID
    field :target_node_id, ID

    field :source_node, Types::NodeType, description: "The node the edge points from."
    field :target_node, Types::NodeType, description: "The node the edge points to."

    field :metadata, GraphQL::Types::JSON,
          description: "Open-ended per-edge annotation: protocol, cardinality, criticality, renderer hints."

    field :created_at, GraphQL::Types::ISO8601DateTime

    def id
      object.id.to_s
    end

    def source_node_id
      object.source_node_id.to_s
    end

    def target_node_id
      object.target_node_id.to_s
    end

    # Batched, so an inspector listing twenty edges resolves their endpoints in one query
    # rather than twenty.
    def source_node
      load_record(Node, object.source_node_id)
    end

    def target_node
      load_record(Node, object.target_node_id)
    end
  end
end
