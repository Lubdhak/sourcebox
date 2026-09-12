# frozen_string_literal: true

# Base class for every background job.
#
# Provides two things all jobs need and none should reimplement:
#
#   1. Request correlation. The `request_id` of the HTTP request that caused the job
#      is serialized with the job and restored before `perform` runs, so a log query
#      for one request id returns the request, its events, and every job it spawned.
#      The ActiveJob `job_id` is retained separately, since one request can fan out
#      to several jobs and you need to tell them apart.
#
#   2. Structured lifecycle events (job.enqueued / job.completed / job.failed) with
#      timing and retry count.
class ApplicationJob < ActiveJob::Base
  # Deadlocks and lock waits are transient under concurrent workers; retry them.
  retry_on ActiveRecord::Deadlocked, wait: :polynomially_longer, attempts: 5

  # A record deleted between enqueue and perform is not an error worth retrying.
  discard_on ActiveJob::DeserializationError

  attr_accessor :request_id

  # Carry the correlation id through Solid Queue's payload.
  def serialize
    super.merge("request_id" => Current.request_id)
  end

  def deserialize(job_data)
    super
    self.request_id = job_data["request_id"]
  end

  after_enqueue do |job|
    Rails.event.notify(
      Events::Names::JOB_ENQUEUED,
      job_id: job.job_id,
      job_class: job.class.name,
      queue_name: job.queue_name,
      request_id: Current.request_id
    )
  end

  around_perform do |job, block|
    Current.request_id = job.request_id
    Rails.event.set_context(request_id: job.request_id, job_id: job.job_id)

    started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    begin
      block.call

      Rails.event.notify(
        Events::Names::JOB_COMPLETED,
        **job.event_metadata(started_at),
        status: "success"
      )
    rescue StandardError => e
      Rails.event.notify(
        Events::Names::JOB_FAILED,
        **job.event_metadata(started_at),
        status: "failure",
        error_class: e.class.name,
        # The message can contain interpolated user data, so it is redacted and
        # truncated like any other logged value. The backtrace is not logged here;
        # Rails.error carries it to the error tracker instead.
        error_message: Logging::Redactor.call(e.message)
      )

      raise
    end
  end

  # Deliberately excludes `arguments`: job payloads can hold large JSONB blobs or
  # personal data, and they are already persisted in solid_queue_jobs if you need them.
  def event_metadata(started_at)
    {
      job_id: job_id,
      job_class: self.class.name,
      queue_name: queue_name,
      request_id: request_id,
      duration_ms: ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1_000).round(2),
      retry_count: executions - 1,
    }
  end
end
