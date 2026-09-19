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

      # The signed-in identity as every presence surface shows it: face, name, address,
      # and what this person may do in the space they are being shown in. One definition
      # so the Inertia snapshot, the space channel and the node channel never drift on
      # what a peer's card carries -- a photo everywhere but one, or a role spelled two
      # ways, is exactly the kind of thing three call sites converge on if the shape is
      # not written down once.
      #
      # `role` is passed in rather than computed here: an actor is being described in
      # the context of one particular space, and which space that is is something only
      # the caller knows -- a channel already has it from authorizing the subscription,
      # so this does not re-derive it with a second query.
      def actor(user, role:)
        {
          id: user.id.to_s,
          name: user.display_name,
          email: user.email,
          avatarUrl: user.avatar_url,
          colorSeed: user.id,
          role: role&.upcase,
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
        trail = Array(snapshot.trail)
        node_ids = (snapshot.nodes + neighbors + trail + [ snapshot.focus_node ]).compact.map(&:id).uniq
        counts = child_counts(node_ids)
        connections = relationship_counts(node_ids)
        containing_nodes = parent_ids(node_ids)
        parents = parents_by_node(node_ids)

        # Initial props must be complete enough to use without an immediate GraphQL
        # refetch, including the focus, breadcrumb and off-canvas neighbours.
        serialize = lambda do |record|
          node(
            record,
            child_count: counts.fetch(record.id, 0),
            parent_id: containing_nodes[record.id],
            parents: parents.fetch(record.id, [])
          ).merge(relationshipCount: connections.fetch(record.id, 0))
        end

        {
          nodes: snapshot.nodes.map(&serialize),
          relationships: snapshot.relationships.map { |record| relationship(record) },
          neighbors: neighbors.map(&serialize),
          nodeCount: snapshot.node_count,
          relationshipCount: snapshot.relationship_count,
          truncated: snapshot.truncated?,
          focusNode: snapshot.focus_node ? serialize.call(snapshot.focus_node) : nil,
          trail: trail.map(&serialize),
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

      def relationship_counts(node_ids)
        return {} if node_ids.blank?

        outgoing = NodeRelationship.where(source_node_id: node_ids).group(:source_node_id).count
        incoming = NodeRelationship.where(target_node_id: node_ids).group(:target_node_id).count

        node_ids.to_h { |id| [ id, outgoing.fetch(id, 0) + incoming.fetch(id, 0) ] }
      end
    end
  end
end
