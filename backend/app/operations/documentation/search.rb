# frozen_string_literal: true

module Documentation
  # Full-text search across a space's nodes and their content.
  #
  # PostgreSQL, not Elasticsearch. The corpus is one space's documentation, the index is a
  # generated tsvector column PostgreSQL maintains itself, and the query is a GIN lookup:
  # a second datastore would add an ingestion pipeline, a consistency problem and an
  # operational dependency in exchange for nothing at this size. Revisit when ranking
  # needs to consider things the database cannot see, such as click-through.
  #
  # A result is always a node, because a node is what the user navigates to. A block match
  # contributes its text as the snippet and boosts the node's rank; it is never its own
  # result, which would return four rows for one page of documentation.
  #
  # Two queries regardless of how many results match: one for the nodes, one for the
  # matching blocks.
  class Search
    # Deliberately not an Operation: this reads, so it takes no actor and emits no event.
    Result = Struct.new(:node, :rank, :snippet, keyword_init: true)

    MAX_RESULTS = 50

    def self.call(**kwargs)
      new(**kwargs).call
    end

    def initialize(space:, query:, limit: 25)
      @space = space
      @query = query.to_s.strip
      @limit = limit.to_i.clamp(1, MAX_RESULTS)
    end

    def call
      return [] if @query.blank?

      nodes = matching_nodes
      return [] if nodes.empty?

      snippets = snippets_for(nodes.map(&:id))

      nodes.map do |node|
        Result.new(
          node: node,
          rank: node.attributes["search_rank"].to_f,
          snippet: snippets[node.id] || node.summary.to_s.truncate(160)
        )
      end
    end

    private

    # `websearch_to_tsquery` rather than `to_tsquery`: it parses what people type --
    # bare words, "quoted phrases", `or`, `-negation` -- and returns an empty query
    # instead of raising on syntax it does not understand, which matters when the input is
    # a search box that fires on every keystroke.
    def matching_nodes
      scope = @space.nodes

      scope
        .where(id: scope.matching(@query).select(:id))
        .or(scope.where(id: block_matched_node_ids))
        .select(Arel.sql("nodes.*, #{combined_rank_sql} AS search_rank"))
        .order(Arel.sql("search_rank DESC"), :title)
        .limit(@limit)
        .to_a
    end

    # A node's relevance is the better of its own words and its best-matching block.
    #
    # Ranking on the node's tsvector alone would score every node whose match came from
    # its content at exactly zero, which is most of them: a service's name rarely contains
    # the phrase someone searched for, but its overview does. GREATEST over the two keeps
    # title matches ahead of body matches without discarding the body entirely.
    def combined_rank_sql
      ActiveRecord::Base.sanitize_sql_array([ <<~SQL.squish, @query, @query, @query ])
        GREATEST(
          ts_rank(nodes.search_vector, websearch_to_tsquery('english', ?)),
          COALESCE((
            SELECT MAX(ts_rank(content_blocks.search_vector, websearch_to_tsquery('english', ?)))
            FROM content_blocks
            WHERE content_blocks.node_id = nodes.id
              AND content_blocks.search_vector @@ websearch_to_tsquery('english', ?)
          ), 0)
        )
      SQL
    end

    def block_matched_node_ids
      ContentBlock
        .where(node_id: @space.nodes.select(:id))
        .matching(@query)
        .select(:node_id)
    end

    # The best-ranked matching block per node, rendered as plain text. `ts_headline`
    # would mark up the matching terms, but it re-parses the document per row and the
    # frontend highlights client-side anyway.
    def snippets_for(node_ids)
      ContentBlock
        .where(node_id: node_ids)
        .matching(@query)
        .ordered
        .group_by(&:node_id)
        .transform_values { |blocks| blocks.first.preview }
    end
  end
end
