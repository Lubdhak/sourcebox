# frozen_string_literal: true

require "test_helper"

class Documentation::SearchTest < ActiveSupport::TestCase
  setup do
    @space = create_space

    @payments = create_node(space: @space, title: "Payment Service", summary: "Captures money via Stripe")
    @orders = create_node(space: @space, title: "Order Service")
    create_block(
      node: @orders,
      block_type: "markdown",
      data: { "markdown" => "The idempotency key is derived from the order." }
    )
  end

  test "matches a node by its own words" do
    results = search("stripe")

    assert_equal [ @payments.id ], results.map { |result| result.node.id }
  end

  test "matches a node by the content of its blocks" do
    results = search("idempotency")

    assert_equal [ @orders.id ], results.map { |result| result.node.id }
    assert_match(/idempotency key/, results.first.snippet)
  end

  test "ranks a block match above zero" do
    # Ranking on the node's own tsvector alone scores every content match at exactly
    # zero, which is most matches: a service's name rarely contains the phrase someone
    # searched for, but its documentation does.
    results = search("idempotency")

    assert_operator results.first.rank, :>, 0.0
  end

  test "a node matching in both its title and its content appears once" do
    create_block(node: @payments, block_type: "text", data: { "text" => "Payment capture notes" })

    results = search("payment")

    assert_equal 1, results.count { |result| result.node.id == @payments.id }
  end

  test "understands quoted phrases and negation" do
    assert_equal [ @orders.id ], search('"idempotency key"').map { |result| result.node.id }
    assert_empty search("payment -stripe -capture").select { |result| result.node.id == @payments.id }
  end

  test "is scoped to one space" do
    other_space = create_space
    create_node(space: other_space, title: "Payment Service")

    assert_equal [ @payments.id ], search("payment").map { |result| result.node.id }
  end

  test "an empty or whitespace query returns nothing rather than everything" do
    assert_empty search("")
    assert_empty search("   ")
  end

  test "malformed input does not raise" do
    assert_nothing_raised { search("((( &&") }
  end

  test "the limit is capped" do
    30.times { |i| create_node(space: @space, title: "Widget #{i}") }

    assert_operator search("widget", limit: 1_000).size, :<=, Documentation::Search::MAX_RESULTS
  end

  test "loads only one matching snippet block per result in document order" do
    first = create_block(node: @payments, data: { "text" => "First widget note" })
    12.times { create_block(node: @payments, data: { "text" => "Later widget note" }) }
    create_block(node: @orders, data: { "text" => "Order widget note" })
    instantiated = 0
    counter = lambda do |event|
      instantiated += event.payload[:record_count] if event.payload[:class_name] == "ContentBlock"
    end

    results = nil
    ActiveSupport::Notifications.subscribed(counter, "instantiation.active_record") do
      results = search("widget")
    end

    assert_equal 2, results.size
    assert_equal 2, instantiated
    assert_equal first.preview, results.find { |result| result.node.id == @payments.id }.snippet
  end

  private

  def search(query, limit: 25)
    Documentation::Search.call(space: @space, query: query, limit: limit)
  end
end
