# frozen_string_literal: true

# Executes GraphQL the way the controller does, minus HTTP.
#
# Going through Schema.execute rather than posting to /graphql is deliberate for the
# resolver tests: it isolates the schema's behaviour from session handling and CSRF, which
# have their own tests. The context is built with the same two keys GraphqlController
# supplies, so authorization sees exactly what it sees in production.
module GraphqlHelpers
  def execute_graphql(query, variables: {}, user: nil, request_id: "test-request")
    Schema.execute(
      query,
      variables: variables.deep_stringify_keys,
      context: { current_user: user, request_id: request_id }
    ).to_h
  end

  # Asserts the operation failed with one error carrying `code`, and returns its message.
  #
  # Written as a helper because the authorization tests all make the same assertion, and
  # the thing they are really checking -- that a forbidden read is reported identically to
  # a missing one -- is easy to weaken by accident when each test spells it out.
  def assert_graphql_error(result, code, message = nil)
    errors = result["errors"]

    assert errors.present?, "Expected a GraphQL error, got: #{result.inspect}"
    assert_equal code, errors.first.dig("extensions", "code"), "Unexpected error code"
    assert_equal message, errors.first["message"] if message

    errors.first["message"]
  end

  def assert_no_graphql_errors(result)
    assert_nil result["errors"], "Expected no GraphQL errors, got: #{result["errors"].inspect}"
  end
end
