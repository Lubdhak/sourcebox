# frozen_string_literal: true

module Types
  # Base class for every connection in the schema.
  #
  # Overrides the default `pageInfo` type with ours, and adds `totalCount`.
  class BaseConnection < GraphQL::Types::Relay::BaseConnection
    # Redefining the field replaces ConnectionBehaviors' default, which points at
    # GraphQL::Types::Relay::PageInfo.
    field :page_info, Types::PageInfoType,
          null: false,
          description: "Information to aid in pagination."

    field :total_count, Integer,
          null: false,
          description: <<~DESC
            Total number of records, ignoring pagination.

            Costs an extra COUNT query, so request it only when the UI actually renders
            a total. On a large table prefer `pageInfo.hasNextPage` for "is there more?".
          DESC

    def total_count
      items = object.items

      # `size` on a loaded relation counts in memory; on an unloaded one it issues
      # COUNT(*). Either way this avoids instantiating every row just to count them.
      items.respond_to?(:size) ? items.size : items.count
    end
  end
end
