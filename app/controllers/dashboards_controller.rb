# frozen_string_literal: true

# Renders the dashboard page via Inertia.
#
# Note what this controller does NOT do: it does not expose an endpoint for updating
# dashboard state. That is a client-state operation and belongs to the GraphQL mutation,
# so the business rules live in exactly one place.
#
# Inertia supplies the initial page data; GraphQL takes over for every subsequent read
# and write the client drives.
class DashboardsController < ApplicationController
  def show
    dashboard = current_user.primary_dashboard

    render inertia: "Dashboard/Show", props: {
      # Only the identifier and the initial snapshot. The page immediately queries
      # GraphQL for the authoritative state, which keeps one serialization format for
      # dashboard data instead of two that can drift.
      dashboardId: dashboard.id.to_s,
      initialUiState: dashboard.ui_state,
    }
  end
end
