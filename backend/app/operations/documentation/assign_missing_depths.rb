# frozen_string_literal: true

module Documentation
  # Gives a depth to nodes that were created without one.
  #
  # A repair, not a feature, and it exists because depth used to be derived only from a
  # parent's depth: a node created at the top of a space got none, and so did everything
  # anyone then created inside it. The result is a space whose ladder reports zero nodes
  # on every rung and whose canvas cannot tell a node above from one below, since the only
  # thing it has to compare is the rung index. CreateNode no longer leaves that hole; this
  # closes the ones already in the data.
  #
  # Depth is read from containment, which is the same rule CreateNode applies: a node at
  # the top of the space is on rung 0, and a node inside another is one rung below the
  # shallowest thing that contains it. Shallowest, because in a DAG a node can be reached
  # by paths of different lengths, and the shortest is the one a reader travels.
  #
  # Nodes that already have a depth are never touched. Somebody may have deliberately put
  # a child on its parent's rung, and overwriting that would be this task inventing a
  # hierarchy rather than recording one.
  class AssignMissingDepths
    Result = Struct.new(:space, :assigned, :layers_created, keyword_init: true)

    def self.call(**kwargs)
      new(**kwargs).call
    end

    def initialize(space:)
      @space = space
    end

    def call
      depths = depth_by_node
      assigned = 0
      created = 0

      ActiveRecord::Base.transaction do
        depths.group_by { |_, depth| depth }.each do |depth, entries|
          layer, was_created = rung(depth)
          created += 1 if was_created

          # One statement per rung rather than per node: a space can hold thousands, and
          # this is a maintenance task nobody should have to watch.
          assigned += @space.nodes
                            .where(id: entries.map(&:first), layer_id: nil)
                            .update_all(layer_id: layer.id, updated_at: Time.current)
        end
      end

      Result.new(space: @space, assigned: assigned, layers_created: created)
    end

    private

    # Breadth-first from the tops of the space, so the first time a node is reached is by
    # its shortest path. A `contains` cycle terminates because a node is only ever given a
    # depth once.
    def depth_by_node
      children = @space.node_relationships
                       .where(relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                       .pluck(:source_node_id, :target_node_id)
                       .group_by(&:first)
                       .transform_values { |rows| rows.map(&:last) }

      contained = children.values.flatten.to_set
      frontier = @space.nodes.where.not(id: contained.to_a).order(:created_at, :id).pluck(:id)
      depths = frontier.index_with(0)
      depth = 0

      while frontier.any?
        depth += 1
        frontier = frontier.flat_map { |id| children[id] || [] }.uniq.reject { |id| depths.key?(id) }
        frontier.each { |id| depths[id] = depth }
      end

      # Anything left is only reachable through a cycle, so it has no shortest path from a
      # top. It keeps the depth of nothing rather than being guessed at.
      depths
    end

    def rung(index)
      existing = @space.layers.find_by(index: index)
      return [ existing, false ] if existing

      [ @space.layers.create!(index: index, name: Layer.default_name_for(index)), true ]
    end
  end
end
