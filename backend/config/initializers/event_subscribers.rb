# frozen_string_literal: true

# Wires up Rails 8.1 structured event reporting (`Rails.event`).
#
# Two subscribers, deliberately separate concerns:
#
#   JsonSubscriber  -> every event becomes one line of JSON on stdout
#   JobDispatcher   -> a few domain events additionally fan out to Solid Queue
#
# Adding a third destination later (OpenTelemetry, a metrics client, a data
# warehouse stream) means registering another subscriber here. No call site changes,
# because emitters only ever call `Rails.event.notify`.
Rails.application.configure do
  config.after_initialize do
    json_subscriber = Logging::JsonSubscriber.new(
      # Source location is useful when tracing an unfamiliar event back to its
      # emitter, but it is noise in production log volume.
      include_source: !Rails.env.production?
    )

    # `active_record.sql` fires once per query, which makes it the highest-volume event
    # by a wide margin and, in the worker, the *only* one. Solid Queue's pollers check
    # for work every half second, so an idle worker emits a steady BEGIN / SELECT
    # solid_queue_ready_executions / COMMIT trio — roughly 18 lines a second before a
    # single job has run. That buries the job lifecycle events the worker log exists to
    # show, so query logging is opt-in per process:
    #
    #     LOG_SQL=true ./dev            (or set it on one service in docker-compose.yml)
    #
    # The filter block runs instead of the subscriber, so a suppressed event costs one
    # string comparison rather than building and redacting a JSON payload.
    if ActiveModel::Type::Boolean.new.cast(ENV.fetch("LOG_SQL", false))
      Rails.event.subscribe(json_subscriber)
    else
      Rails.event.subscribe(json_subscriber) { |event| event[:name] != "active_record.sql" }
    end

    # Async processing for domain events only. The filter proc means the dispatcher
    # is never even invoked for the high-frequency graphql.* and job.* events.
    Rails.event.subscribe(Events::JobDispatcher.new, &Events::JobDispatcher.filter)

    # In development and test, surface a broken subscriber immediately instead of
    # swallowing it. In production a logging bug must never break a request, so the
    # reporter's default behaviour (report to Rails.error and continue) is correct.
    Rails.event.raise_on_error = Rails.env.local?
  end
end
