# frozen_string_literal: true

module Documentation
  # Copies a node, optionally with everything inside it.
  #
  # What is copied is a judgement about what a copy *means*, so it is worth stating. The
  # node's own documentation comes along: its type, summary, metadata and every content
  # block, because that is the work being duplicated. It lands wherever the original lives
  # -- inside the same parents -- since a copy of a thing belongs beside the thing.
  #
  # Relationships out of the copied set do not come along. A service that calls three
  # others, duplicated, would otherwise assert that the copy also calls those three: a
  # claim about the new thing that nobody has made yet, spread across someone else's part
  # of the graph. Edges *within* the copied set are a different matter and are preserved,
  # because they describe the structure being copied rather than its surroundings -- a
  # duplicated subsystem whose internal wiring was dropped is not a duplicate of it.
  class CloneNode < Operation
    # Far enough that the copy is visibly its own card rather than a redraw of the
    # original, close enough to read as related. The canvas persists positions, so this is
    # the copy's real coordinate and the user can move it.
    OFFSET = 48

    def initialize(node:, include_children: false, **options)
      super(**options)

      @node = node
      @include_children = include_children
    end

    def call
      originals = [ @node ] + (@include_children ? Subtree.call(node: @node) : [])

      clone, mapping = ActiveRecord::Base.transaction do
        copies = originals.to_h { |original| [ original.id, duplicate(original) ] }

        copy_internal_edges(originals, copies)
        attach_to_parents_of_original(copies.fetch(@node.id))

        [ copies.fetch(@node.id), copies ]
      end

      publish(
        Events::Names::DOCUMENTATION_NODE_CLONED,
        space_id: space.id,
        node_id: clone.id,
        source_node_id: @node.id,
        node_count: mapping.size
      )

      clone
    end

    private

    def space
      @node.documentation_space
    end

    # Only the root of the copy is nudged aside. The nodes inside keep their coordinates,
    # because those are relative to a canvas of their own -- the copy's contents, which
    # nothing else is drawn on.
    def duplicate(original)
      root = original.id == @node.id

      copy = space.nodes.create!(
        title: root ? "#{original.title} copy" : original.title,
        node_type: original.node_type,
        summary: original.summary,
        x: original.x + (root ? OFFSET : 0),
        y: original.y + (root ? OFFSET : 0),
        z: original.z,
        width: original.width,
        height: original.height,
        depth: original.depth,
        metadata: original.metadata
      )

      original.content_blocks.order(:position).each do |block|
        copy.content_blocks.create!(
          block_type: block.block_type,
          data: block.data,
          position: block.position
        )
      end

      copy
    end

    def copy_internal_edges(originals, copies)
      ids = originals.map(&:id)

      space.node_relationships.where(source_node_id: ids, target_node_id: ids).find_each do |edge|
        NodeRelationship.create!(
          documentation_space_id: space.id,
          source_node_id: copies.fetch(edge.source_node_id).id,
          target_node_id: copies.fetch(edge.target_node_id).id,
          relationship_type: edge.relationship_type,
          metadata: edge.metadata
        )
      end
    end

    # Every parent, not one: if the original is genuinely contained by two systems, the
    # copy sits beside it in both, and the user sees it wherever they were working.
    def attach_to_parents_of_original(clone)
      parent_ids = space.node_relationships
                        .where(target_node_id: @node.id, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                        .pluck(:source_node_id)

      parent_ids.each do |parent_id|
        NodeRelationship.create!(
          documentation_space_id: space.id,
          source_node_id: parent_id,
          target_node_id: clone.id,
          relationship_type: NodeRelationship::HIERARCHICAL_TYPE
        )
      end
    end
  end
end
