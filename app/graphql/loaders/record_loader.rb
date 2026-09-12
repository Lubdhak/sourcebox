# frozen_string_literal: true

module Loaders
  # Batches primary-key (or unique-column) lookups into a single query.
  #
  # Without batching, a list of N dashboards each exposing `user` issues N queries --
  # the classic GraphQL N+1. GraphQL::Dataloader collects every `.load(...)` requested
  # during a single execution pass and calls `fetch` once with all the keys.
  #
  #   dashboard(1) -> user_id 7 -.
  #   dashboard(2) -> user_id 7  |--> SELECT * FROM users WHERE id IN (7, 9)
  #   dashboard(3) -> user_id 9 -'
  #
  # Usage from a type:
  #
  #   def user
  #     dataloader.with(Loaders::RecordLoader, User).load(object.user_id)
  #   end
  #
  # graphql-ruby also ships GraphQL::Dataloader::ActiveRecordSource, which does the same
  # thing for the plain id case. This exists because it additionally supports lookups by
  # an arbitrary unique column and a default scope, and because it is the seam where
  # you would add per-request caching or instrumentation.
  class RecordLoader < GraphQL::Dataloader::Source
    # `scope` is part of the batch key, so two call sites requesting different scopes do
    # not accidentally share a batch.
    def initialize(model, column: model.primary_key, scope: nil)
      @model = model
      @column = column.to_s
      @scope = scope

      super()
    end

    # Contract: return an array positionally aligned with `keys`, using nil for keys
    # with no matching record. Returning a different length or order silently mismatches
    # results to fields.
    def fetch(keys)
      records = base_scope.where(@column => keys).index_by { |record| record.public_send(@column) }

      keys.map { |key| records[cast(key)] }
    end

    private

    def base_scope
      @scope || @model.all
    end

    # Keys arriving from GraphQL ID arguments are strings, while the indexed column is
    # typically an integer. Without casting, `records[key]` misses every time and every
    # lookup silently returns nil.
    def cast(key)
      @model.type_for_attribute(@column).cast(key)
    end
  end
end
