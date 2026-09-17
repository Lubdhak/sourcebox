# frozen_string_literal: true

module Loaders
  # Batches "how many nodes does this one contain?" across a canvas.
  #
  # The count drives the dive-in affordance on every card, so it is requested once per
  # node on screen. Unbatched that is one COUNT per card; batched it is a single grouped
  # query for the whole canvas.
  #
  # Not expressed through AssociationLoader because the answer is a number, not the
  # records: loading 400 nodes' worth of edge rows to call `.size` on them would pull the
  # whole containment graph into memory to render a badge.
  class ChildCountLoader < GraphQL::Dataloader::Source
    def initialize(relationship_type = NodeRelationship::HIERARCHICAL_TYPE)
      @relationship_type = relationship_type

      super()
    end

    def fetch(node_ids)
      counts = NodeRelationship
               .where(source_node_id: node_ids, relationship_type: @relationship_type)
               .group(:source_node_id)
               .count

      # `fetch(id, 0)` rather than `[id]`: a node that contains nothing has no row in the
      # grouped result, and the loader must return a value per key in key order.
      node_ids.map { |id| counts.fetch(id, 0) }
    end
  end
end
