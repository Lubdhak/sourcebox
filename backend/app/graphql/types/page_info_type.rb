# frozen_string_literal: true

module Types
  # Cursor pagination metadata. Exposed as `PageInfo` (graphql-ruby strips the trailing
  # "Type" from class names).
  #
  # Descends from GraphQL::Schema::Object rather than Types::BaseObject because
  # BaseObject wires up connections, and connections reference this type -- inheriting
  # from BaseObject would make that circular.
  #
  # PageInfoBehaviors supplies the four standard Relay fields (hasNextPage,
  # hasPreviousPage, startCursor, endCursor) with the correct nullability, so they are
  # not reimplemented by hand.
  class PageInfoType < GraphQL::Schema::Object
    include GraphQL::Types::Relay::PageInfoBehaviors

    description "Cursor-based pagination metadata for a connection."
  end
end
