# frozen_string_literal: true

# Sends user-facing notifications triggered by domain events.
#
# `deliver_now` is correct here: this job *is* the async boundary. Calling
# `deliver_later` would enqueue a second job to do the same work.
class NotificationJob < ApplicationJob
  queue_as :default

  # A bad address is permanent; retrying it just burns worker capacity.
  discard_on ActiveJob::DeserializationError

  def perform(event_name:, payload:)
    return unless event_name == Events::Names::USER_CREATED

    user = User.find_by(id: payload["user_id"])
    return if user.nil?

    UserMailer.welcome(user).deliver_now
  end
end
