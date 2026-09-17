# frozen_string_literal: true

module Documentation
  # Adds a node to a space, optionally with content blocks and an incoming edge.
  #
  # Blocks and the edge are created in the same transaction as the node. Authoring a node
  # is one user gesture ("add a Payment Service under API, with an overview"), and
  # splitting it across three mutations would let a failure leave a titled node with no
  # content and no place in the graph.
  class CreateNode < Operation
    def initialize(space:, title:, node_type: "concept", summary: nil,
                   x: 0.0, y: 0.0, z: 0.0, width: nil, height: nil, depth: nil,
                   layer_id: nil, metadata: {}, blocks: [], parent_node_id: nil,
                   parent_relationship_type: NodeRelationship::HIERARCHICAL_TYPE, **options)
      super(**options)

      @space = space
      @attributes = {
        title: title,
        node_type: node_type.presence || "concept",
        summary: summary,
        x: x, y: y, z: z,
        layer_id: layer_id,
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
      provisioned_layer = false

      node = ActiveRecord::Base.transaction do
        parent = resolve_parent
        layer_id, provisioned_layer = layer_for(parent)
        @attributes[:layer_id] = layer_id if layer_id

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
        layer_id: node.layer_id,
        layer_provisioned: provisioned_layer,
        block_count: @blocks.size
      )

      node
    end

    private

    # Scoped to the space rather than looked up globally: a parent id from another space
    # must fail as "no such parent", not create a cross-space edge. The model enforces
    # this too; doing it here gives the user a field error instead of a generic one.
    #
    # With no parent named, the space's root adopts the node. That is what keeps a space
    # one connected graph instead of a scattering of unrelated trees: the canvas draws one
    # level at a time, so a node with no parent is reachable only from the very top, and a
    # handful of them accumulate there as a pile of things whose relationship to the
    # documented system is unstated. Everything belongs somewhere, and the first node in
    # the space is where "somewhere" starts.
    def resolve_parent
      return space_root if @parent_node_id.blank?

      @space.nodes.find_by(id: @parent_node_id).tap do |parent|
        raise ActiveRecord::RecordNotFound, "No such parent node in this space" if parent.nil?
      end
    end

    # The oldest node nothing contains, and nil while the space is empty -- which is how
    # the first node ever created becomes the root rather than by being marked as one.
    #
    # Oldest, not "the only one", because a space that already grew several tops (seeded
    # data, or nodes created before this rule) must still have one answer, and the
    # earliest is the one the author started from.
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

    # Which rung the node lands on: the one below its parent, or the first rung if it is
    # the root of the space.
    #
    # Every node gets a depth, and that is the correction to an earlier version of this
    # method: a node created with no parent was left with none, and since a child's depth
    # is derived from its parent's, one rootless node meant an entire tree beneath it with
    # no depth at all. The ladder then reported zero nodes on every rung and the canvas
    # could not tell a node above from one below, because the only thing it has to compare
    # is the rung index.
    def layer_for(parent)
      return [ nil, false ] if @attributes[:layer_id].present?
      return rung(0) if parent.nil?

      layer_below(parent)
    end

    # A node created inside another one belongs one rung deeper, and if the parent is
    # already on the deepest rung the ladder grows to hold it. This is what makes depth
    # unbounded in practice rather than only in the schema: the user dives into a node and
    # adds something, and the depth they needed comes into existence.
    #
    # The rung is created here, inside the transaction and through the model, rather than
    # by calling CreateLayer. CreateLayer would emit its own event from inside this
    # transaction, which the Operation base class explicitly forbids -- a subscriber could
    # act on a layer that a rollback then erased. The provisioning is reported on this
    # operation's own event instead, which is also the truth: the user added a node, and a
    # depth appeared as a consequence.
    #
    # An explicit layer always wins. Placing a child on the same rung as its parent, or on
    # any other, is a legitimate thing to ask for -- containment and depth are related by
    # default and not welded together.
    # A parent with no depth is treated as being on the first rung, which is where a node
    # without one would be put today. It only arises for nodes created before every node
    # had a depth.
    def layer_below(parent)
      rung((parent.layer&.index || 0) + 1)
    end

    # The rung at this index, brought into existence if it is not there yet. Returns the
    # id and whether it had to be created, which the event reports.
    def rung(index)
      existing = @space.layers.find_by(index: index)
      return [ existing.id, false ] if existing

      created = @space.layers.create!(index: index, name: Layer.default_name_for(index))

      [ created.id, true ]
    end
  end
end
