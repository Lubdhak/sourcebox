# frozen_string_literal: true

module Documentation
  # The one definition of how a documentation graph looks on the wire.
  #
  # Three things now send the same records to the same client: the Inertia snapshot on
  # first paint, the GraphQL types on every refetch, and the realtime channel on every
  # collaborator's change. GraphQL derives its shape from its own type definitions, which
  # leaves these two -- and while there were only two, keeping them in step by hand was
  # merely a risk. With a third, arriving asynchronously and merging into state the other
  # two produced, a disagreement about casing or nesting stops being a cosmetic bug and
  # becomes a node that appears twice or not at all.
  #
  # So the shape lives here, camelCase and string ids, matching what the GraphQL types
  # return. Anything that sends a node to a browser goes through this module.
  module WireFormat
    class << self
      def space(space)
        {
          # The public id, not the database id: this is what appears in URLs and in every
          # GraphQL argument naming a space.
          id: space.public_id,
          name: space.name,
          slug: space.slug,
          description: space.description,
          settings: space.settings,
        }
      end

      # Access, as the client needs to see it: one person's row in the share dialog.
      #
      # The role is upcased because that is how the GraphQL enum spells it, and this
      # module exists to make the two paths agree. Storage keeps the lowercase form --
      # `SpaceRole` maps between them -- so the upcasing belongs here at the edge rather
      # than in the column.
      def membership(membership)
        {
          id: membership.id.to_s,
          role: membership.role.upcase,
          pending: membership.pending?,
          name: membership.display_name,
          email: membership.email,
          userId: membership.user_id&.to_s,
        }
      end

      # Only ever called for an admin -- see DocumentationSpacesController. Who else can
      # read a document is not information the document itself should hand to a viewer.
      def memberships(space)
        space.space_memberships.includes(:user).order(:created_at).map { |record| membership(record) }
      end

      # `child_count` and `parent_id` are passed in rather than derived, because the caller
      # knows whether it is serializing one node or four hundred. See `child_counts` and
      # `parent_ids`.
      def node(node, child_count: nil, parent_id: nil, parents: nil)
        {
          id: node.id.to_s,
          title: node.title,
          summary: node.summary,
          position: { x: node.x, y: node.y, z: node.z },
          size: { width: node.width, height: node.height, depth: node.depth },
          metadata: node.metadata,
          childCount: child_count || 0,
          parentNodeId: parent_id&.to_s,
          parents: Array(parents).map do |parent|
            { id: parent[:id].to_s, title: parent[:title], parentNodeId: parent[:parent_node_id]&.to_s }
          end,
        }
      end

      def relationship(relationship)
        {
          id: relationship.id.to_s,
          relationshipType: relationship.relationship_type,
          sourceNodeId: relationship.source_node_id.to_s,
          targetNodeId: relationship.target_node_id.to_s,
          metadata: relationship.metadata,
        }
      end

      # Content blocks are deliberately absent.
      #
      # A space's nodes are the canvas; their content is a page of documentation each, and
      # loading every page to draw the map would make first paint proportional to how much
      # has been written rather than to how much is on screen. The inspector fetches the
      # selected node's blocks from GraphQL when it opens.
      def graph(snapshot)
        neighbors = Array(snapshot.neighbors)
        counts = child_counts(snapshot.nodes.map(&:id))
        # Only the neighbours need a single parent id: the one thing the client does with
        # a neighbour is go to the level that holds it.
        neighbor_parents = parent_ids(neighbors.map(&:id))
        # The cards on the canvas need the parents themselves, named, because the card's
        # up-a-level control has to offer a choice when a node is filed in several places.
        parents = parents_by_node(snapshot.nodes.map(&:id))

        {
          nodes: snapshot.nodes.map do |record|
            node(record, child_count: counts.fetch(record.id, 0), parents: parents.fetch(record.id, []))
          end,
          relationships: snapshot.relationships.map { |record| relationship(record) },
          neighbors: neighbors.map { |record| node(record, parent_id: neighbor_parents[record.id]) },
          nodeCount: snapshot.node_count,
          relationshipCount: snapshot.relationship_count,
          truncated: snapshot.truncated?,
          focusNode: snapshot.focus_node ? node(snapshot.focus_node, child_count: counts.fetch(snapshot.focus_node.id, 0)) : nil,
          trail: Array(snapshot.trail).map { |record| node(record) },
        }
      end

      # The containing node of each of these, lowest id wins where there are several --
      # the rule Documentation::AncestorTrail and Loaders::ParentLoader both follow, so
      # that every path in the UI agrees about where a node lives.
      def parent_ids(node_ids)
        return {} if node_ids.blank?

        NodeRelationship
          .where(target_node_id: node_ids, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
          .order(:source_node_id)
          .pluck(:target_node_id, :source_node_id)
          .reverse
          .to_h
      end

      # Two queries for a whole canvas: the containment edges into it, then the parents
      # they name. Each parent carries its own parent id, because navigating to a parent
      # means opening the level *it* lives on -- a node is only ever drawn among siblings.
      def parents_by_node(node_ids)
        return {} if node_ids.blank?

        edges = NodeRelationship
                .where(target_node_id: node_ids, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                .order(:source_node_id)
                .pluck(:target_node_id, :source_node_id)

        parent_ids = edges.map(&:last).uniq
        titles = Node.where(id: parent_ids).pluck(:id, :title).to_h
        grandparents = parent_ids(parent_ids)

        edges.group_by(&:first).transform_values do |rows|
          rows.filter_map do |(_, parent_id)|
            next unless titles.key?(parent_id)

            { id: parent_id, title: titles[parent_id], parent_node_id: grandparents[parent_id] }
          end
        end
      end

      # One grouped query for a whole canvas, rather than a COUNT per card.
      def child_counts(node_ids)
        return {} if node_ids.blank?

        NodeRelationship
          .where(source_node_id: node_ids, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
          .group(:source_node_id)
          .count
      end
    end
  end
end
