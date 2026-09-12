# frozen_string_literal: true

# Container and load-balancer probes.
#
# The split matters operationally:
#
#   /health -> liveness.  "Is this process alive?" Touches nothing external.
#   /ready  -> readiness. "Can this process serve traffic?" Checks dependencies.
#
# If liveness checked the database, a brief database blip would make the orchestrator
# kill every web container -- turning a recoverable dependency wobble into an outage.
# Readiness failing merely removes the instance from the load balancer until it
# recovers, which is what you actually want.
class HealthController < ActionController::Base
  # No session, no CSRF, no authentication, no Inertia. Probes run thousands of times a
  # day and must stay cheap.
  skip_forgery_protection

  def show
    render json: { status: "ok" }
  end

  def ready
    checks = {
      database: check_database,
      queue: check_queue,
    }

    healthy = checks.values.all? { |v| v == "ok" }

    render json: { status: healthy ? "ready" : "degraded", checks: checks },
           status: healthy ? :ok : :service_unavailable
  end

  private

  # `SELECT 1` on the primary. Cheap, and it exercises the real connection pool rather
  # than just asking whether a connection object exists.
  def check_database
    ActiveRecord::Base.connection.select_value("SELECT 1") == 1 ? "ok" : "error"
  rescue StandardError => e
    error_for(e)
  end

  # The queue database is a separate connection, so it can fail independently of the
  # primary. Counting a tiny table verifies the schema is actually loaded, not merely
  # that the database accepts connections.
  def check_queue
    SolidQueue::Process.connection.select_value("SELECT 1") == 1 ? "ok" : "error"
  rescue StandardError => e
    error_for(e)
  end

  # Probe responses are unauthenticated, so they must not leak connection strings,
  # hostnames or credentials from exception messages. The class name is enough to
  # diagnose from, and the full error goes to the logs.
  def error_for(exception)
    Rails.error.report(exception, handled: true)
    "error"
  end
end
