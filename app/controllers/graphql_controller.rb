# frozen_string_literal: true

# The single GraphQL endpoint.
#
# Authentication is the Devise session that Inertia navigation already established --
# there is no second auth mechanism, no token exchange, no API key. The browser sends its
# session cookie, so CSRF protection (inherited from ApplicationController) is
# load-bearing and the client must send X-CSRF-Token.
class GraphqlController < ApplicationController
  # Authorization is enforced inside the schema so an anonymous request gets a structured
  # GraphQL error instead of a 302 to the login page, which an XHR client cannot follow.
  skip_before_action :authenticate_user!

  # Batched queries are not supported. A single endpoint accepting an array of operations
  # multiplies the cost of every limit we set (depth, complexity, page size) by the array
  # length, so it is refused rather than silently allowed.
  MAX_QUERY_BYTES = 16.kilobytes

  def execute
    return render_error("Query is too large.", :payload_too_large) if query_too_large?
    return render_error("Batched queries are not supported.", :bad_request) if batched?

    result = Schema.execute(
      params[:query],
      variables: prepared_variables,
      operation_name: params[:operationName],
      context: graphql_context
    )

    render json: result
  rescue JSON::ParserError
    render_error("Variables must be valid JSON.", :bad_request)
  rescue StandardError => e
    handle_unexpected_error(e)
  end

  private

  # The strongly structured context every resolver reads from. `current_user` is the
  # Devise helper; `request_id` is what ties a GraphQL operation to the HTTP request and
  # to any job it spawns.
  def graphql_context
    {
      current_user: current_user,
      request_id: request.request_id,
    }
  end

  def query_too_large?
    params[:query].to_s.bytesize > MAX_QUERY_BYTES
  end

  def batched?
    params[:_json].present?
  end

  # Variables arrive as a JSON object from our client, but may be a string from other
  # tooling.
  def prepared_variables
    case params[:variables]
    when String
      params[:variables].present? ? JSON.parse(params[:variables]) : {}
    when ActionController::Parameters
      params[:variables].to_unsafe_h
    when Hash
      params[:variables]
    else
      {}
    end
  end

  def render_error(message, status)
    render json: { errors: [ { message: message, extensions: { code: status.to_s.upcase } } ], data: nil },
           status: status
  end

  # An unexpected exception is a bug, not a client error. It is reported in full
  # internally and reduced to an opaque message externally, with the request id so a user
  # can quote it in a support ticket and we can find the real error.
  def handle_unexpected_error(exception)
    Rails.error.report(exception, handled: false)

    Rails.event.notify(
      Events::Names::GRAPHQL_ERROR,
      operation_name: params[:operationName].presence || "anonymous",
      request_id: request.request_id,
      error_class: exception.class.name,
      error_message: Logging::Redactor.call(exception.message)
    )

    # Re-raise in development so the error page and stack trace are available locally.
    raise exception if Rails.env.local?

    render json: {
      errors: [ {
        message: "Something went wrong.",
        extensions: { code: "INTERNAL_ERROR", requestId: request.request_id },
      } ],
      data: nil,
    }, status: :internal_server_error
  end
end
