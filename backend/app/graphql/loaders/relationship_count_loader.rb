# frozen_string_literal: true

module Loaders
  # Batches "how many things is this node connected to?" across a canvas.
  #
  # Both directions in one number, and every relationship type, because the question it
  # answers is whether the node is attached to the graph at all. Which end of an edge it
  # sits on, and whether the edge is containment or a call, do not change that answer.
  #
  # Two grouped queries rather than one: an edge is counted by its source in the first and
  # by its target in the second, and "group by whichever column is in this set" is not a
  # single GROUP BY. Still independent of how many nodes are on screen, which is the
  # property that matters -- unbatched this would be two COUNTs per card.
  class RelationshipCountLoader < GraphQL::Dataloader::Source
    def fetch(node_ids)
      outgoing = NodeRelationship.where(source_node_id: node_ids).group(:source_node_id).count
      incoming = NodeRelationship.where(target_node_id: node_ids).group(:target_node_id).count

      # `fetch(id, 0)` rather than `[id]`: a node connected to nothing has no row in
      # either grouped result, and the loader must return a value per key in key order.
      node_ids.map { |id| outgoing.fetch(id, 0) + incoming.fetch(id, 0) }
    end
  end
end
