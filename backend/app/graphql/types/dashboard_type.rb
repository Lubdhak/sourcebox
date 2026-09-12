# frozen_string_literal: true

module Types
  class DashboardType < Types::BaseObject
    description "A user's dashboard and its client-owned view state."

    field :id, ID,
          description: "Globally unique identifier."

    field :ui_state, Types::DashboardUiStateType,
          description: "Client-owned view state."

    field :user, Types::UserType,
          description: "The owner of this dashboard."

    field :created_at, GraphQL::Types::ISO8601DateTime
    field :updated_at, GraphQL::Types::ISO8601DateTime

    # DashboardUiStateType reads its fields straight off the Dashboard record, so the
    # dashboard is its own `object`. This keeps ui_state a typed sub-selection in the
    # schema without allocating a wrapper for every dashboard.
    def ui_state
      object
    end

    # Batched. Rendering N dashboards issues one users query, not N.
    #
    # Note this returns the owner via the dataloader rather than `object.user`, which
    # would lazily fire a query per dashboard.
    def user
      load_record(User, object.user_id)
    end
  end
end
