# frozen_string_literal: true

module Types
  class MutationType < Types::BaseObject
    description "Root mutation."

    field :update_dashboard_state, mutation: Mutations::UpdateDashboardState
  end
end
