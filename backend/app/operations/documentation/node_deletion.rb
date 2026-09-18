# frozen_string_literal: true

module Documentation
  # The one deletion implementation: what a deletion would do, and doing it.
  #
  # Both live here on purpose. Previously the preview (`DeletionImpact`) and the mutation
  # (`DeleteNode`) each decided for themselves what "delete this" meant, which is fine
  # until the two disagree -- and they did: the preview reported the node's own edges while
  # the delete also destroyed its descendants' edges, so the dialog understated the damage
  # of the button next to the one being hovered. Execution now calls `impact` first and
  # deletes exactly the set the preview named, so the two cannot drift.
  #
  # Single and bulk are the same code path. A single deletion is a bulk deletion of one
  # node; there is no branch anywhere in this file on `nodes.size`.
  class NodeDeletion < Operation
    # One node in the preview, flattened for the wire.
    Entry = Struct.new(:id, :title, :reason, keyword_init: true)

    # One reference, either an edge or a sentence. `kind` is the relationship verb for an
    # edge and "mention" for prose, which is the only distinction the dialog draws.
    Reference = Struct.new(
      :id, :kind, :source_id, :source_title, :target_id, :target_title,
      keyword_init: true
    )

    Impact = Struct.new(
      :space,
      :policy,
      :selected,
      :orphans,
      :retained,
      :references,
      :deleted_ids,
      :block_count,
      :digest,
      keyword_init: true
    ) do
      def selected_count
        selected.size
      end

      def orphan_count
        orphans.size
      end

      # What the extra option costs, over and above the selection itself.
      def additional_delete_count
        policy.delete_orphans? ? orphans.size : 0
      end

      def reference_count
        references.size
      end

      # Distinct nodes this operation touches at all: the ones going, and the ones left
      # holding a changed page. The number the dialog leads with.
      def affected_count
        (deleted_ids + references.map(&:source_id)).uniq.size
      end
    end

    # Raised when the graph moved under the user between preview and execute.
    class ImpactChanged < StandardError
      attr_reader :impact

      def initialize(impact)
        @impact = impact
        super("The deletion impact changed while it was being reviewed.")
      end
    end

    # Ceiling on what is listed rather than counted. Past this nobody reads the list, and
    # a hub node with a thousand edges should not turn a confirmation into a page load.
    MAX_LISTED = 200

    def initialize(nodes:, policy: nil, **options)
      super(**options)

      @nodes = Array(nodes).compact.uniq(&:id)
      @policy = policy || DeletionPolicy.new
    end

    # Read-only. Safe to call on every policy change in the dialog.
    def impact
      @impact ||= build_impact
    end

    # Applies the deletion described by `impact`.
    #
    # `expected_digest` is the preview the user actually looked at. When it no longer
    # matches, nothing is written and `ImpactChanged` carries the fresh impact, so the
    # dialog can redraw rather than destroy a set the user never saw.
    def call(expected_digest: nil)
      current = impact

      if expected_digest.present? && expected_digest != current.digest
        raise ImpactChanged, current
      end

      return [] if current.deleted_ids.empty?

      counts = ActiveRecord::Base.transaction do
        # References first: rewriting prose reads the titles of the nodes about to go, and
        # after a hard delete those rows are not there to read.
        stripped = if @policy.remove_references?
                     ReferenceScanner.strip(
                       space: space,
                       target_ids: current.deleted_ids,
                       excluding_node_ids: current.deleted_ids
                     )
                   else
                     0
                   end

        # Re-homed before anything is destroyed, so the containment edges being read are
        # still there to read.
        rehome_survivors(current) if @policy.keep_orphans?

        removed = { block_count: current.block_count, stripped_block_count: stripped }

        if @policy.hard?
          # `with_deleted`, because hard-deleting something already in the bin is a
          # legitimate request and the default scope would silently skip it.
          Node.with_deleted.where(id: current.deleted_ids).destroy_all
        else
          Node.with_deleted.where(id: current.deleted_ids).update_all(
            deleted_at: Time.current,
            deleted_by_id: actor&.id,
            updated_at: Time.current
          )
        end

        removed
      end

      publish(
        Events::Names::DOCUMENTATION_NODE_DELETED,
        space_id: space.id,
        node_id: current.deleted_ids.first,
        node_ids: current.deleted_ids,
        node_count: current.deleted_ids.size,
        relationship_count: current.reference_count,
        cascade: @policy.delete_orphans?,
        **@policy.to_h,
        **counts
      )

      current.deleted_ids
    end

    private

    def space
      @space ||= @nodes.first&.documentation_space
    end

    def build_impact
      return empty_impact if @nodes.empty?

      selected_ids = @nodes.map(&:id)
      descendants = descendants_of(selected_ids)
      candidate_ids = selected_ids + descendants.map(&:id)

      # A descendant that also lives somewhere outside the doomed set is not losing its
      # home, only one of them. Reporting it as about to be deleted would overstate what
      # the operation does, which is the difference between a dialog people trust and one
      # they learn to click through.
      retained, orphaned = descendants.partition { |node| parented_outside?(node.id, candidate_ids) }

      deleted_ids = @policy.delete_orphans? ? selected_ids + orphaned.map(&:id) : selected_ids
      references = gather_references(deleted_ids)

      Impact.new(
        space: space,
        policy: @policy,
        selected: @nodes.map { |node| Entry.new(id: node.id, title: node.title) },
        orphans: orphaned.first(MAX_LISTED).map do |node|
          Entry.new(id: node.id, title: node.title, reason: "Its only parent is being deleted")
        end,
        retained: retained.first(MAX_LISTED).map do |node|
          Entry.new(id: node.id, title: node.title, reason: "Also filed somewhere else")
        end,
        references: references,
        deleted_ids: deleted_ids,
        block_count: ContentBlock.where(node_id: deleted_ids).count,
        digest: digest_for(deleted_ids, references)
      )
    end

    def empty_impact
      Impact.new(
        space: nil, policy: @policy,
        selected: [], orphans: [], retained: [], references: [],
        deleted_ids: [], block_count: 0, digest: digest_for([], [])
      )
    end

    # Breadth-first through `contains`, de-duplicated and bounded. See Subtree.
    def descendants_of(ids)
      seen = ids.to_set

      @nodes.flat_map { |node| Subtree.call(node: node) }
            .reject { |descendant| !seen.add?(descendant.id) }
    end

    def parented_outside?(node_id, doomed_ids)
      space.node_relationships
           .where(target_node_id: node_id, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
           .where.not(source_node_id: doomed_ids)
           .exists?
    end

    # Edges and sentences in one list, because the user's question is "what points at this"
    # and the storage mechanism is not part of the question.
    #
    # Containment is excluded: every node has a `contains` edge to its parent and its
    # children, and reporting those as references would mean the count was dominated by the
    # hierarchy the user is already looking at.
    def gather_references(doomed_ids)
      return [] if doomed_ids.empty?

      edges = space.node_relationships
                   .where.not(relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                   .where(target_node_id: doomed_ids)
                   .where.not(source_node_id: doomed_ids)
                   .order(:id)
                   .limit(MAX_LISTED)
                   .to_a

      titles = Node.with_deleted
                   .where(id: edges.flat_map { |e| [ e.source_node_id, e.target_node_id ] }.uniq + doomed_ids)
                   .pluck(:id, :title)
                   .to_h

      from_edges = edges.map do |edge|
        Reference.new(
          id: "edge-#{edge.id}",
          kind: edge.relationship_type,
          source_id: edge.source_node_id,
          source_title: titles[edge.source_node_id] || "an untitled node",
          target_id: edge.target_node_id,
          target_title: titles[edge.target_node_id] || "an untitled node"
        )
      end

      from_mentions = ReferenceScanner
                      .find(space: space, target_ids: doomed_ids, excluding_node_ids: doomed_ids)
                      .first(MAX_LISTED)
                      .map do |mention|
        Reference.new(
          id: "mention-#{mention.block_id}-#{mention.target_node_id}",
          kind: "mention",
          source_id: mention.source_node_id,
          source_title: mention.source_title,
          target_id: mention.target_node_id,
          target_title: titles[mention.target_node_id] || "an untitled node"
        )
      end

      from_edges + from_mentions
    end

    # The children take the deleted node's place: whatever contained it now contains them.
    # With no parent, the node was at the top of the space and its children rise to the
    # top too, which is the same statement.
    def rehome_survivors(current)
      containment = space.node_relationships.where(relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
      doomed = current.deleted_ids

      doomed.each do |node_id|
        grandparent_ids = containment.where(target_node_id: node_id).pluck(:source_node_id) - doomed
        child_ids = containment.where(source_node_id: node_id).pluck(:target_node_id) - doomed

        grandparent_ids.product(child_ids).each do |parent_id, child_id|
          next if parent_id == child_id

          NodeRelationship.find_or_create_by!(
            documentation_space_id: space.id,
            source_node_id: parent_id,
            target_node_id: child_id,
            relationship_type: NodeRelationship::HIERARCHICAL_TYPE
          )
        end
      end
    end

    # A fingerprint of everything the user was shown.
    #
    # Covers the policy as well as the graph, so switching from soft to hard between
    # preview and confirm is caught by the same check that catches a collaborator moving a
    # node into the selection.
    def digest_for(deleted_ids, references)
      material = [
        @policy.fingerprint,
        deleted_ids.sort.join(","),
        references.map(&:id).sort.join(",")
      ].join("|")

      Digest::SHA256.hexdigest(material)
    end
  end
end
