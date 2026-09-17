# frozen_string_literal: true

module Loaders
  # Batches "which nodes contain this one?" across a canvas.
  #
  # Plural, unlike ParentLoader, because containment is many-to-many and the card has to
  # say so: a node filed in two systems offers a choice of where "up" goes, and one that
  # is filed nowhere offers none, so the card cannot draw the control until it knows which
  # it is.
  class ParentsLoader < GraphQL::Dataloader::Source
    def fetch(node_ids)
      edges = NodeRelationship
              .where(target_node_id: node_ids, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
              .order(:source_node_id)
              .pluck(:target_node_id, :source_node_id)

      parent_ids = edges.map(&:last).uniq
      parents = Node.where(id: parent_ids).index_by(&:id)

      grouped = edges.group_by(&:first)

      node_ids.map do |id|
        (grouped[id] || []).filter_map { |(_, parent_id)| parents[parent_id] }
      end
    end
  end
end
