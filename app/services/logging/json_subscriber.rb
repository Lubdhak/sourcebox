# frozen_string_literal: true

module Logging
  # Rails.event subscriber that writes one JSON object per line to stdout.
  #
  # Container-native logging: the process writes to stdout and the container runtime
  # owns collection, rotation and shipping. Nothing is written to a file inside the
  # container, so `docker compose logs` and every hosted log pipeline
  # (Datadog, Loki, ELK, CloudWatch, GCP Cloud Logging) work without a sidecar or
  # a volume mount.
  #
  # Subscribers must implement `emit(event)`, receiving the event hash that
  # ActiveSupport::EventReporter builds:
  #   { name:, payload:, tags:, context:, timestamp:, source_location: }
  class JsonSubscriber
    def initialize(io: $stdout, include_source: false)
      @io = io
      @io.sync = true
      @include_source = include_source
    end

    def emit(event)
      @io.puts(JSON.generate(build(event)))
    rescue StandardError => e
      # A logging failure must never take down the request that triggered it.
      # Fall back to a single-line marker on stderr and move on.
      warn(%({"event":"logging.failure","error_class":"#{e.class}"}))
    end

    private

    def build(event)
      base = {
        event: event[:name],
        timestamp: format_timestamp(event[:timestamp]),
        level: level_for(event[:name]),
      }

      base
        .merge(Redactor.call(event[:context].presence || {}))
        .merge(payload_for(event))
        .merge(tags_for(event))
        .merge(source_for(event))
        .compact
    end

    # The payload is usually a Hash, but Rails.event also accepts an arbitrary event
    # object. Keep both shapes loggable rather than raising inside the logger.
    def payload_for(event)
      payload = event[:payload]

      case payload
      when nil  then {}
      when Hash then Redactor.call(payload)
      else { payload: Redactor.call(payload.respond_to?(:to_h) ? payload.to_h : payload) }
      end
    end

    def tags_for(event)
      tags = event[:tags]
      return {} if tags.blank?

      { tags: Redactor.call(tags) }
    end

    def source_for(event)
      return {} unless @include_source

      source = event[:source_location]
      return {} if source.blank?

      { source: "#{source[:filepath]}:#{source[:lineno]}" }
    end

    # EventReporter timestamps are nanoseconds since the epoch.
    def format_timestamp(nanoseconds)
      return Time.now.utc.iso8601(3) if nanoseconds.blank?

      Time.at(0, nanoseconds, :nanosecond).utc.iso8601(3)
    end

    def level_for(name)
      case name
      when /\.(error|failure|failed)\z/ then "error"
      else "info"
      end
    end
  end
end
