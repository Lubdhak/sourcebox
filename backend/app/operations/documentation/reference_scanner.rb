# frozen_string_literal: true

module Documentation
  # Finds and rewrites the references that live inside prose rather than in the edge table.
  #
  # There are two ways one node points at another here, and only one of them has a foreign
  # key. A `NodeRelationship` row is enforced by the database and disappears on its own
  # when either end is destroyed. An `@`-mention is a Markdown link inside
  # `content_blocks.data` -- `[@Payment Service](#node-42)` -- and the database has no idea
  # it is a reference at all. Deleting node 42 used to leave that text behind, pointing at
  # nothing, with no warning at the moment of deletion and no way to find it afterwards.
  #
  # This is the piece that makes the mention format queryable. `#node-<id>)` is a literal,
  # unambiguous token -- the trailing paren is what stops `#node-4` matching `#node-42` --
  # so one regex over the JSONB text finds every referring block in a space.
  #
  # See `frontend/src/features/documentation/inspector/mentions.ts`, which owns the format
  # this file has to agree with.
  class ReferenceScanner
    # One prose pointer, said in the terms the delete dialog needs: which page holds it,
    # and which node it points at.
    Mention = Struct.new(:block_id, :source_node_id, :source_title, :target_node_id, keyword_init: true)

    # `node_reference` blocks say it structurally instead of in prose.
    NODE_REFERENCE_TYPE = "node_reference"

    class << self
      # Every block outside `excluding_node_ids` that points at one of `target_ids`.
      #
      # The exclusion matters: a node being deleted that mentions another node being
      # deleted is not a referrer anyone needs to hear about, because the page holding the
      # mention is going away too.
      def find(space:, target_ids:, excluding_node_ids: [])
        ids = normalize(target_ids)
        return [] if ids.empty?

        blocks = candidate_blocks(space, ids, normalize(excluding_node_ids))
        return [] if blocks.empty?

        titles = Node.with_deleted.where(id: blocks.map(&:node_id)).pluck(:id, :title).to_h

        blocks.flat_map do |block|
          targets_in(block, ids).map do |target_id|
            Mention.new(
              block_id: block.id,
              source_node_id: block.node_id,
              source_title: titles[block.node_id] || "an untitled node",
              target_node_id: target_id
            )
          end
        end
      end

      # Flattens every pointer at `target_ids` back into plain words.
      #
      # `[@Payment Service](#node-42)` becomes `@Payment Service`: the link goes, the name
      # stays. Deleting the sentence would be the wrong repair -- somebody wrote it, and it
      # still says something true about what used to be there -- and leaving the link would
      # mean a click that reports the node could not be loaded.
      #
      # Returns the number of blocks rewritten.
      def strip(space:, target_ids:, excluding_node_ids: [])
        ids = normalize(target_ids)
        return 0 if ids.empty?

        blocks = candidate_blocks(space, ids, normalize(excluding_node_ids))
        rewritten = 0

        blocks.each do |block|
          data = block.data.deep_dup
          changed = false

          # Prose: every string value in the payload is searched, because a mention can
          # sit in `markdown`, in `text`, or in a table cell, and the payload shape is
          # per-block-type by design.
          data = walk_strings(data) do |string|
            stripped = strip_mentions(string, ids)
            changed ||= stripped != string
            stripped
          end

          # Structural: the block *is* the reference, so there is nothing to unlink. It
          # becomes the text it was already rendering, which keeps the words and the
          # position in the page.
          if block.block_type == NODE_REFERENCE_TYPE && ids.include?(data["nodeId"].to_i)
            label = data["label"].presence || data["title"].presence || "a deleted node"
            block.block_type = "text"
            data = { "text" => label.to_s }
            changed = true
          end

          next unless changed

          block.data = data
          block.save!
          rewritten += 1
        end

        rewritten
      end

      private

      def normalize(ids)
        Array(ids).map { |id| Integer(id, exception: false) }.compact.uniq
      end

      # One query per space rather than one per target. The regex is built from integers
      # that have already been through `Integer()`, so there is nothing to escape.
      def candidate_blocks(space, ids, excluded_ids)
        scope = space.nodes
        scope = scope.where.not(id: excluded_ids) if excluded_ids.any?

        ContentBlock
          .where(node_id: scope.select(:id))
          .where(
            "data::text ~ :pattern OR (block_type = :reference_type AND data->>'nodeId' IN (:string_ids))",
            pattern: "#node-(#{ids.join('|')})\\)",
            reference_type: NODE_REFERENCE_TYPE,
            string_ids: ids.map(&:to_s)
          )
          .order(:node_id, :position)
          .to_a
      end

      # Which of `ids` this block actually points at. The SQL narrows to candidates; this
      # is what turns a candidate into a specific edge, and it runs over a handful of rows.
      def targets_in(block, ids)
        found = []

        walk_strings(block.data) do |string|
          string.scan(/#node-(\d+)\)/) { |(id)| found << id.to_i }
          string
        end

        found << block.data["nodeId"].to_i if block.block_type == NODE_REFERENCE_TYPE

        found.uniq & ids
      end

      def strip_mentions(string, ids)
        # The label may contain escaped brackets, because `mentionMarkdown` escapes them
        # rather than stripping them -- the title belongs to whoever wrote it. So the label
        # is matched as "anything that is not a bracket, or an escaped anything", and the
        # escapes are undone on the way out.
        string.gsub(/\[@((?:[^\[\]\\]|\\.)*)\]\(#node-(\d+)\)/) do
          label = Regexp.last_match(1)
          target = Regexp.last_match(2).to_i

          if ids.include?(target)
            "@#{label.gsub(/\\([\[\]])/, '\1')}"
          else
            Regexp.last_match(0)
          end
        end
      end

      # Applies a transform to every string anywhere in a JSON payload, preserving shape.
      def walk_strings(value, &block)
        case value
        when String then block.call(value)
        when Array  then value.map { |item| walk_strings(item, &block) }
        when Hash   then value.transform_values { |item| walk_strings(item, &block) }
        else value
        end
      end
    end
  end
end
