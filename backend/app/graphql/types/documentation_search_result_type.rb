# frozen_string_literal: true

module Types
  # Exposed as `DocumentationSearchResult`.
  #
  # A result is always a node, never a block. A node is what the user navigates to and
  # what the canvas can focus on; four matching blocks on one service should be one
  # result with a snippet, not four rows pointing at the same place.
  class DocumentationSearchResultType < Types::BaseObject
    graphql_name "DocumentationSearchResult"
    description "A node matching a search, with the text that matched."

    field :node, Types::NodeType, description: "The matching node."

    field :snippet, String,
          description: "Plain-text excerpt from the best-matching content block, or the node's summary."

    field :rank, Float,
          description: "PostgreSQL relevance score. Higher is better; comparable only within one result set."
  end
end
