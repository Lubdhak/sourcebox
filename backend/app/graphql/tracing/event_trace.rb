# frozen_string_literal: true

module Tracing
  # GraphQL observability, emitted through Rails.event.
  #
  # Installed with `trace_with` (the modern API; the old `instrument(...)` hooks were
  # removed). One event per operation with timing, operation type, and error count:
  #
  #   { "event": "graphql.request", "operation_name": "DocumentationSpace",
  #     "operation_type": "query", "duration_ms": 18, "status": "success" }
  #
  # Mutations additionally emit graphql.mutation so write traffic can be alerted on
  # separately from reads.
  module EventTrace
    def execute_query(query:)
      started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)

      result = super

      report(query, started_at, result)

      result
    rescue StandardError => e
      # A raised exception never reaches the client verbatim; the schema's error handlers
      # convert it. This records that it happened, with the class only.
      Rails.event.notify(
        Events::Names::GRAPHQL_ERROR,
        operation_name: operation_name_for(query),
        operation_type: query.selected_operation&.operation_type,
        request_id: query.context[:request_id],
        user_id: query.context[:current_user]&.id,
        error_class: e.class.name
      )

      raise
    end

    private

    def report(query, started_at, result)
      duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1_000).round(2)

      errors = Array(result.to_h["errors"])
      operation_type = query.selected_operation&.operation_type || "query"

      payload = {
        operation_name: operation_name_for(query),
        operation_type: operation_type,
        request_id: query.context[:request_id],
        user_id: query.context[:current_user]&.id,
        duration_ms: duration_ms,
        status: errors.any? ? "error" : "success",
        error_count: errors.size,
        # Deliberately NOT logging `query.variables`: variables carry user data and can be
        # large. Only the shape of the request is recorded.
        complexity: query.context[:graphql_complexity],
      }.compact

      Rails.event.notify(Events::Names::GRAPHQL_REQUEST, **payload)

      if operation_type == "mutation"
        Rails.event.notify(Events::Names::GRAPHQL_MUTATION, **payload)
      end

      return if errors.empty?

      Rails.event.notify(
        Events::Names::GRAPHQL_ERROR,
        **payload.merge(
          # Error *codes* from extensions are safe and useful; messages may contain
          # interpolated data, so they are not logged here.
          error_codes: errors.filter_map { |e| e.dig("extensions", "code") }.uniq
        )
      )
    end

    # Anonymous operations are legal but unattributable. Naming them is a client-side
    # discipline worth being able to measure, so they are recorded explicitly rather
    # than silently as nil.
    def operation_name_for(query)
      query.operation_name.presence || "anonymous"
    end
  end
end
