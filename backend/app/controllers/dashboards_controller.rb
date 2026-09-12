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
      # Only the identifier and an initial snapshot, so the page renders real content on
      # first paint instead of a spinner. The page then queries GraphQL for the
      # authoritative state.
      dashboardId: dashboard.id.to_s,
      initialUiState: serialize_ui_state(dashboard),
    }
  end

  private

  # Emitted in the same shape the GraphQL `DashboardUiState` type returns, including
  # SCREAMING_CASE enum values for theme and layout.
  #
  # This matters: the page receives its first state from Inertia and every later state
  # from GraphQL. If the two disagreed on casing, the frontend would need two types and a
  # conversion for one concept, and a bug would only appear after the first mutation.
  # The GraphQL representation wins because it is the one with a schema.
  def serialize_ui_state(dashboard)
    {
      theme: dashboard.theme.upcase,
      layout: dashboard.layout.upcase,
      visibleWidgets: dashboard.visible_widgets,
      widgetSettings: dashboard.widget_settings,
    }
  end
end
