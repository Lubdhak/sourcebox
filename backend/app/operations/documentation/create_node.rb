# frozen_string_literal: true

module Documentation
  # Adds a node to a space, optionally with content blocks and an incoming edge.
  #
  # Blocks and the edge are created in the same transaction as the node. Authoring a node
  # is one user gesture ("add a Payment Service under API, with an overview"), and
  # splitting it across three mutations would let a failure leave a titled node with no
  # content and no place in the graph.
  class CreateNode < Operation
    def initialize(space:, title:, node_type: "service", summary: nil,
                   x: 0.0, y: 0.0, z: 0.0, width: nil, height: nil, depth: nil,
                   metadata: {}, blocks: [], parent_node_id: nil,
                   parent_relationship_type: NodeRelationship::HIERARCHICAL_TYPE, **options)
      super(**options)

      @space = space
      @attributes = {
        title: title,
        node_type: node_type.presence || "service",
        summary: summary,
        x: x, y: y, z: z,
        metadata: metadata || {},
      }.compact
      @attributes[:width] = width if width
      @attributes[:height] = height if height
      @attributes[:depth] = depth if depth

      @blocks = Array(blocks)
      @parent_node_id = parent_node_id
      @parent_relationship_type = parent_relationship_type
    end

    def call
      node = ActiveRecord::Base.transaction do
        parent = resolve_parent
        record = @space.nodes.create!(**@attributes)

        @blocks.each_with_index do |block, index|
          record.content_blocks.create!(
            block_type: block[:block_type] || block["block_type"],
            data: block[:data] || block["data"] || {},
            position: index
          )
        end

        create_parent_edge(record, parent)

        record
      end

      publish(
        Events::Names::DOCUMENTATION_NODE_CREATED,
        space_id: @space.id,
        node_id: node.id,
        node_type: node.node_type,
        block_count: @blocks.size
      )

      node
    end

    private

    def resolve_parent
      return space_root if @parent_node_id.blank?

      @space.nodes.find_by(id: @parent_node_id).tap do |parent|
        raise ActiveRecord::RecordNotFound, "No such parent node in this space" if parent.nil?
      end
    end

    def space_root
      contained = NodeRelationship
                  .where(documentation_space_id: @space.id, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                  .select(:target_node_id)

      @space.nodes.where.not(id: contained).order(:created_at, :id).first
    end

    def create_parent_edge(node, parent)
      return if parent.nil?

      NodeRelationship.create!(
        documentation_space: @space,
        source_node: parent,
        target_node: node,
        relationship_type: @parent_relationship_type
      )
    end
  end
end
