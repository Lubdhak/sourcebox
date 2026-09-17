# frozen_string_literal: true

module Events
  # Rails.event subscriber that fans domain events out to Solid Queue.
  #
  # This is the seam that keeps request threads fast. A controller or GraphQL mutation
  # writes to PostgreSQL and emits one event; everything secondary (auditing,
  # analytics, notifications) happens in a worker process afterwards.
  #
  #   GraphQL mutation -> UPDATE -> Rails.event.notify -> JobDispatcher -> Solid Queue
  #
  # Two rules make this safe to run inline on the request thread:
  #
  #   1. It only ever *enqueues*. Enqueuing is a single INSERT; no HTTP calls, no
  #      rendering, no report building happens here.
  #   2. It never raises. A failure to enqueue an audit record must not fail the
  #      mutation that the user actually asked for.
  class JobDispatcher
    # Events that trigger background work, and the jobs each one starts.
    ROUTES = {
      Names::DASHBOARD_UPDATED  => [ AuditDashboardChangeJob, AnalyticsEventJob ],
      Names::USER_CREATED       => [ NotificationJob, AnalyticsEventJob ],
      Names::USER_AUTHENTICATED => [ AnalyticsEventJob ],
      Names::OAUTH_SUCCESS      => [ AnalyticsEventJob ],
      Names::OAUTH_FAILURE      => [ AnalyticsEventJob ],

      # Documentation graph mutations feed analytics only.
      #
      # `node_moved` is deliberately absent: dragging a node emits one event per batched
      # save, which on an active canvas is the highest-frequency domain event by an order
      # of magnitude. It is still logged by JsonSubscriber, but enqueuing a job for it
      # would put a row in the queue database for every drag gesture in exchange for
      # nothing anyone reads.
      Names::DOCUMENTATION_SPACE_CREATED => [ AnalyticsEventJob ],
      Names::DOCUMENTATION_NODE_CREATED  => [ AnalyticsEventJob ],
      Names::DOCUMENTATION_NODE_DELETED  => [ AnalyticsEventJob ],
      Names::DOCUMENTATION_NODE_CLONED   => [ AnalyticsEventJob ],
      Names::DOCUMENTATION_RELATIONSHIP_CREATED => [ AnalyticsEventJob ],
      Names::DOCUMENTATION_RELATIONSHIP_DELETED => [ AnalyticsEventJob ],
    }.freeze

    # Only these events reach the subscriber. Job lifecycle events are deliberately
    # excluded: dispatching on `job.enqueued` would enqueue a job for every job
    # forever.
    def self.filter
      ->(event) { ROUTES.key?(event[:name]) }
    end

    def emit(event)
      jobs = ROUTES[event[:name]]
      return if jobs.blank?

      payload = normalize(event[:payload])

      jobs.each do |job_class|
        enqueue(job_class, event[:name], payload)
      end
    end

    private

    def enqueue(job_class, event_name, payload)
      job_class.perform_later(event_name: event_name, payload: payload)
    rescue StandardError => e
      # Report and continue. Losing a background job is bad; failing the user's
      # request because a background job could not be queued is worse.
      Rails.error.report(e, handled: true, context: { event_name: event_name, job_class: job_class.name })
    end

    # Job arguments must be ActiveJob-serializable, and they are persisted in
    # PostgreSQL where they may sit for a while. Keep them to plain scalars and drop
    # anything sensitive before it is written.
    def normalize(payload)
      return {} unless payload.is_a?(Hash)

      Logging::Redactor.call(payload).transform_keys(&:to_s)
    end
  end
end
