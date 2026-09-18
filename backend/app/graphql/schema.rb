# frozen_string_literal: true

class Schema < GraphQL::Schema
  query Types::QueryType
  mutation Types::MutationType

  # Batched loading for every field that asks for it. Without this, a query selecting
  # `documentationSpaces { owner { ... } }` issues one query per space.
  use GraphQL::Dataloader

  # --- Query safeguards --------------------------------------------------
  #
  # A GraphQL endpoint accepts arbitrary query shapes, so cost has to be bounded at the
  # schema rather than per resolver. Without these, one request can walk a cyclic graph
  # (space -> node -> space -> node ...) and exhaust the database.
  max_depth 12
  max_complexity 300

  # Report up to 10 validation errors at once instead of stopping at the first, but bound
  # the work spent validating a hostile document.
  validate_max_errors 10

  # --- Pagination limits -------------------------------------------------
  #
  # `default_page_size` applies when a client omits first/last; `default_max_page_size`
  # caps what it can ask for. Together they make an unbounded list impossible, which is
  # why every collection field is a connection.
  default_page_size 25
  default_max_page_size 100

  # --- Introspection policy ---------------------------------------------
  #
  # Introspection is disabled in production.
  #
  # The tradeoff: introspection is what powers GraphiQL, schema-diff tooling and client
  # codegen, so turning it off costs real developer convenience and does NOT make the API
  # secure -- anyone can still guess or replay field names, and the schema is present in
  # the frontend bundle. It is defence in depth, not a security boundary: it raises the
  # cost of automated schema-scraping and of attackers discovering fields we did not mean
  # to expose.
  #
  # Because this schema is only consumed by our own first-party frontend, which is
  # versioned with the server, we lose nothing in production and keep introspection in
  # development where the tooling lives. For a public API you would leave it enabled and
  # rely on authorization instead.
  disable_introspection_entry_points if Rails.env.production?

  # --- Observability -----------------------------------------------------
  trace_with Tracing::EventTrace

  # --- Error handling ----------------------------------------------------
  #
  # The rule for everything below: clients get a stable code and a safe message; the
  # details go to the logs. No exception classes, backtraces, SQL or record ids that the
  # caller is not entitled to.

  rescue_from(ActiveRecord::RecordNotFound) do
    raise ApplicationGraphql::NotFoundError
  end

  rescue_from(ActiveRecord::RecordInvalid) do |error|
    raise ApplicationGraphql::ValidationError.new(
      error.record&.errors&.full_messages&.to_sentence || "Validation failed.",
      fields: error.record&.errors&.to_hash&.transform_values { |m| m.map(&:to_s) } || {}
    )
  end

  # Raised by `authorize_owner!` / field-level `authorized?`.
  def self.unauthorized_object(error)
    raise ApplicationGraphql::ForbiddenError
  end

  def self.unauthorized_field(error)
    raise ApplicationGraphql::ForbiddenError
  end

  # Anything not converted above. This is the last line of defence against an internal
  # error becoming an information leak.
  def self.type_error(error, context)
    Rails.event.notify(
      Events::Names::GRAPHQL_ERROR,
      error_class: error.class.name,
      request_id: context[:request_id]
    )

    super
  end
end
