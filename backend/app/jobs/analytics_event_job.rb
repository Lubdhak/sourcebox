# frozen_string_literal: true

# Normalizes a domain event into an analytics envelope.
#
# There is no vendor SDK here on purpose. The envelope is emitted as a structured
# event, which the JsonSubscriber writes to stdout, which the log pipeline already
# forwards. That is a complete analytics path for a new product and costs nothing.
#
# To send to a real sink (Segment, Amplitude, a warehouse stream), replace the
# `Rails.event.notify` below with the client call. Because this runs in a worker, a
# slow or failing vendor cannot affect request latency, and Solid Queue's retries
# cover transient vendor outages.
class AnalyticsEventJob < ApplicationJob
  queue_as :analytics

  # Analytics is the lowest-value work in the system; never let it exhaust retries
  # against a hard failure.
  discard_on ActiveRecord::RecordInvalid

  def perform(event_name:, payload:)
    Rails.event.notify(
      "analytics.tracked",
      analytics_event: event_name,
      user_id: payload["user_id"],
      space_id: payload["space_id"],
      request_id: request_id,
      occurred_at: Time.current.iso8601
    )
  end
end
