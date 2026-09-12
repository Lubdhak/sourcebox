# frozen_string_literal: true

# Writes an immutable audit trail entry for a dashboard state change.
#
# Runs out-of-band so the mutation that triggered it returns as soon as the
# authoritative write to `dashboards` has committed.
class AuditDashboardChangeJob < ApplicationJob
  queue_as :critical

  def perform(event_name:, payload:)
    dashboard_id = payload["dashboard_id"]
    return if dashboard_id.blank?

    AuditLog.create!(
      event_name: event_name,
      dashboard_id: dashboard_id,
      user_id: payload["user_id"],
      request_id: request_id,
      changed_keys: Array(payload["changed_keys"]),
      occurred_at: Time.current
    )
  end
end
