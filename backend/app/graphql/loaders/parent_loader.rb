# frozen_string_literal: true

module Loaders
  # Batches "which node contains this one?" across a canvas.
  #
  # Asked of every node the canvas draws from elsewhere in the space: a neighbour shown
  # faintly because something on screen connects to it is navigated to by opening the
  # level it lives on, which is its parent. Unbatched that is one lookup per ghost card.
  #
  # A node can be contained by more than one parent, so "the" parent does not exist. The
  # lowest-numbered one is chosen, which is the same rule Documentation::AncestorTrail
  # follows when it picks a breadcrumb -- the two must agree, or clicking a neighbour
  # would land somewhere its own breadcrumb then contradicts.
  class ParentLoader < GraphQL::Dataloader::Source
    def fetch(node_ids)
      parents = NodeRelationship
                .where(target_node_id: node_ids, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                .order(:source_node_id)
                .pluck(:target_node_id, :source_node_id)

      # Built back-to-front so that the *first* parent in source order wins: `[]=` keeps
      # the last write, and the rows arrive ascending.
      first_parents = parents.reverse.to_h

      node_ids.map { |id| first_parents[id] }
    end
  end
end
