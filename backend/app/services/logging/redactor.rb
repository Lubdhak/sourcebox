# frozen_string_literal: true

module Logging
  # Strips credentials and trims unbounded values before anything reaches a log.
  #
  # This runs on every event payload, so redaction is structural rather than something
  # each call site has to remember. Matching is on key *substrings* so that
  # `access_token`, `oauth_refresh_token` and `credentials` are all caught without an
  # exhaustive list.
  module Redactor
    REDACTED = "[REDACTED]"

    # Substrings that mark a value as sensitive.
    SENSITIVE_KEY_PATTERNS = %w[
      password passwd secret token credential authorization auth_header
      cookie session csrf api_key apikey private_key signature client_secret
      access_token refresh_token id_token bearer
    ].freeze

    # Values longer than this are truncated. GraphQL variables and job arguments can
    # carry large JSONB blobs that would otherwise dominate the log stream.
    MAX_VALUE_LENGTH = 512

    # Depth guard: a hostile or buggy payload must not be able to spend unbounded CPU
    # in the logger.
    MAX_DEPTH = 6

    class << self
      def call(value, depth: 0)
        return "[TRUNCATED_DEPTH]" if depth > MAX_DEPTH

        case value
        when Hash  then redact_hash(value, depth)
        when Array then value.first(50).map { |v| call(v, depth: depth + 1) }
        when String then truncate(value)
        when Numeric, TrueClass, FalseClass, NilClass, Symbol then value
        when Time, DateTime then value.iso8601
        else truncate(value.to_s)
        end
      end

      def sensitive_key?(key)
        normalized = key.to_s.downcase
        SENSITIVE_KEY_PATTERNS.any? { |pattern| normalized.include?(pattern) }
      end

      private

      def redact_hash(hash, depth)
        hash.each_with_object({}) do |(key, value), result|
          result[key.to_sym] = if sensitive_key?(key)
            REDACTED
          else
            call(value, depth: depth + 1)
          end
        end
      end

      def truncate(string)
        return string if string.length <= MAX_VALUE_LENGTH

        "#{string[0, MAX_VALUE_LENGTH]}…[truncated #{string.length - MAX_VALUE_LENGTH}]"
      end
    end
  end
end
