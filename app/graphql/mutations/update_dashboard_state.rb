# frozen_string_literal: true

module Mutations
  # Persists a partial update to a dashboard's UI state.
  #
  #   authorize -> UPDATE PostgreSQL -> Rails.event.notify -> return
  #                                            |
  #                                            +-> Solid Queue (audit, analytics)
  #
  # The request thread does the authoritative write and nothing else. Auditing and
  # analytics happen in a worker, so the client's optimistic update is confirmed as soon
  # as the row is committed.
  class UpdateDashboardState < BaseMutation
    description "Update the client-owned view state of a dashboard."

    argument :dashboard_id, ID, description: "The dashboard to update."
    argument :ui_state, Types::DashboardUiStateInputType,
             description: "Fields to change. Omitted fields are left as they are."

    field :dashboard, Types::DashboardType, description: "The updated dashboard."

    def resolve(dashboard_id:, ui_state:)
      dashboard = authorize_owner!(Dashboard.find_by(id: dashboard_id))

      changes = normalize(ui_state, dashboard)
      merged = dashboard.ui_state.merge(changes)

      # No-op updates should not produce an audit entry or bump updated_at. Optimistic
      # UIs re-send state readily, so this is a common case rather than an edge case.
      return { dashboard: dashboard } if merged == dashboard.ui_state

      dashboard.ui_state = merged
      validation_error!(dashboard) unless dashboard.save

      # Emitted after the write has committed. The subscriber only enqueues jobs, so this
      # returns in microseconds.
      Rails.event.notify(
        Events::Names::DASHBOARD_UPDATED,
        dashboard_id: dashboard.id,
        user_id: current_user.id,
        # Which keys changed, not their values: this payload is persisted as a job
        # argument and must not become a copy of user data.
        changed_keys: changes.keys,
        request_id: context[:request_id]
      )

      { dashboard: dashboard }
    end

    private

    # GraphQL hands us a symbol-keyed input object; `ui_state` is a string-keyed JSONB
    # document. Converting here keeps that mismatch in one place.
    #
    # Only keys the client actually sent are included, which is what makes this a partial
    # update rather than a replace.
    def normalize(input, dashboard)
      changes = {}

      changes["theme"] = input[:theme] if input.key?(:theme)
      changes["layout"] = input[:layout] if input.key?(:layout)

      if input.key?(:visible_widgets)
        changes["visibleWidgets"] = Array(input[:visible_widgets]).map(&:to_s)
      end

      if input.key?(:widget_settings)
        changes["widgetSettings"] = merged_widget_settings(input[:widget_settings], dashboard)
      end

      changes
    end

    # Merged key-by-key rather than replaced, so a client saving one widget's settings
    # cannot wipe every other widget's.
    def merged_widget_settings(incoming, dashboard)
      unless incoming.is_a?(Hash)
        raise ApplicationGraphql::ValidationError, "widgetSettings must be an object."
      end

      dashboard.widget_settings.merge(incoming.deep_stringify_keys)
    end
  end
end
