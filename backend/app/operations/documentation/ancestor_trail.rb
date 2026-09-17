# frozen_string_literal: true

module Documentation
  # The path from the top of a space down to one node: the breadcrumb for drill-down.
  #
  # This is where the graph and the folder metaphor actually disagree, and the disagreement
  # has to be resolved somewhere. A node can be contained by more than one parent -- a
  # `users` table legitimately sits inside both Identity and Billing -- so "the" path up
  # does not exist. A breadcrumb has to show one, so one is chosen deterministically: the
  # lowest-numbered containing parent at each step. Same node, same trail, every time,
  # for every collaborator looking at it.
  #
  # Walked a rung at a time in Ruby rather than in a recursive CTE. The CTE would be one
  # query instead of `depth` queries, but it cannot express "pick exactly one parent per
  # level" -- window functions are not allowed inside the recursive term -- so it would
  # return every path through the DAG and the choosing would happen here anyway, over a
  # result set that can grow combinatorially. Each step here is a single indexed lookup on
  # (documentation_space_id, target_node_id), and depth is single digits in practice.
  class AncestorTrail
    # A guard against a pathological ladder, not against cycles -- `visited` handles
    # those. Nothing in the schema forbids a `contains` cycle, because forbidding it would
    # mean a cycle check on every edge write, and a cycle is survivable here.
    MAX_DEPTH = 256

    def self.call(**kwargs)
      new(**kwargs).call
    end

    def initialize(node:)
      @node = node
    end

    # Ordered outermost-first, so it renders left to right as a breadcrumb. Excludes the
    # node itself: the trail is where it lives, not what it is.
    def call
      trail = []
      visited = Set.new([ @node.id ])
      current = @node

      MAX_DEPTH.times do
        parent = parent_of(current)
        break if parent.nil? || visited.include?(parent.id)

        visited << parent.id
        trail.unshift(parent)
        current = parent
      end

      trail
    end


    private

    def parent_of(node)
      parent_id = NodeRelationship
                  .where(
                    documentation_space_id: node.documentation_space_id,
                    target_node_id: node.id,
                    relationship_type: NodeRelationship::HIERARCHICAL_TYPE
                  )
                  .order(:source_node_id)
                  .limit(1)
                  .pick(:source_node_id)

      return nil if parent_id.nil?

      Node.find_by(id: parent_id)
    end
  end
end
