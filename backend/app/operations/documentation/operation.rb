# frozen_string_literal: true

module Documentation
  # Base class for every mutation of a documentation graph.
  #
  # Why a layer at all, when the codebase has managed without one: graph mutations are not
  # single-record saves. Creating a relationship has to check that both endpoints live in
  # the same space; deleting a block has to close the gap it leaves in its siblings'
  # positions; moving fifty nodes has to be one statement rather than fifty. That is
  # domain logic, and it belongs neither in a GraphQL resolver -- where it would be
  # unreachable from seeds, jobs and the console -- nor in a model callback, where it
  # would fire on every save whether or not the caller wanted it.
  #
  # So each operation is one class, one public `call`, one transaction, and one event.
  # GraphQL mutations authorize and delegate; they contain no graph logic.
  #
  #   Mutation -> Operation -> models -> Rails.event.notify -> Solid Queue
  #
  # Errors: operations use the bang methods and let ActiveRecord::RecordInvalid escape.
  # The schema already converts it into a VALIDATION_FAILED error carrying per-field
  # messages (see Schema.rescue_from), so catching and re-wrapping here would only lose
  # information.
  class Operation
    class << self
      def call(**kwargs)
        new(**kwargs).call
      end
    end

    # `actor` is the user the change is attributed to in events. It is not an
    # authorization check: authorization happened at the boundary, against the space, and
    # repeating it here would either duplicate that rule or quietly disagree with it.
    def initialize(actor:, request_id: nil, **)
      @actor = actor
      @request_id = request_id || Current.request_id
    end

    private

    attr_reader :actor, :request_id

    # Emitted after the transaction commits, never inside it.
    #
    # Inside a transaction the subscriber would enqueue jobs against work that a later
    # rollback erases, and a worker fast enough to pick one up would read a row that does
    # not exist. Every caller below therefore notifies after `transaction` returns.
    def publish(name, **payload)
      Rails.event.notify(
        name,
        actor_id: actor&.id,
        request_id: request_id,
        **payload
      )
    end
  end
end
