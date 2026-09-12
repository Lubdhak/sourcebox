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
    # Structured logs for every event.
    Rails.event.subscribe(
      Logging::JsonSubscriber.new(
        # Source location is useful when tracing an unfamiliar event back to its
        # emitter, but it is noise in production log volume.
        include_source: !Rails.env.production?
      )
    )

    # Async processing for domain events only. The filter proc means the dispatcher
    # is never even invoked for the high-frequency graphql.* and job.* events.
    Rails.event.subscribe(Events::JobDispatcher.new, &Events::JobDispatcher.filter)

    # In development and test, surface a broken subscriber immediately instead of
    # swallowing it. In production a logging bug must never break a request, so the
    # reporter's default behaviour (report to Rails.error and continue) is correct.
    Rails.event.raise_on_error = Rails.env.local?
  end
end
