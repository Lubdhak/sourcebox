# frozen_string_literal: true

require "test_helper"

class Documentation::GraphTest < ActiveSupport::TestCase
  setup do
    @user = create_user
    @space = create_space(user: @user, name: "Platform")
    @services = create_layer(space: @space, index: 1, name: "Services")

    @gateway = create_node(space: @space, title: "API Gateway", layer: @services, x: 0, y: 0)
    @orders = create_node(space: @space, title: "Order Service", layer: @services, x: 300, y: 0)
    @detail = create_node(space: @space, title: "orders table", x: 600, y: 0)

    create_relationship(source: @gateway, target: @orders, relationship_type: "calls")
    create_relationship(source: @orders, target: @detail, relationship_type: "contains")
  end

  test "returns the outermost nodes and the edges between them" do
    graph = fetch_graph

    assert_equal 2, graph["nodeCount"]
    assert_equal 2, graph["relationshipCount"], "relationshipCount is the whole space, not this level"
    assert_not graph["truncated"]
    assert_equal [ "API Gateway", "Order Service" ], graph["nodes"].map { |n| n["title"] }.sort
  end

  test "a nested node appears only when the node containing it is opened" do
    assert_not_includes fetch_graph["nodes"].map { |n| n["title"] }, "orders table",
                        "A node inside another one is not part of the level above it"

    inside = fetch_graph(focusNodeId: @orders.id.to_s)

    assert_equal [ "orders table" ], inside["nodes"].map { |n| n["title"] }
  end

  test "an edge that leaves the level returns the node at its far end" do
    # The `orders` table is two levels down and writes to something at the top of the
    # space: the exact case a level-scoped canvas would otherwise show as unconnected.
    create_relationship(source: @detail, target: @gateway, relationship_type: "writes_to")

    inside = fetch_graph(focusNodeId: @orders.id.to_s)

    assert_equal [ "API Gateway" ], inside["neighbors"].map { |n| n["title"] }
    assert_nil inside["neighbors"].first["parentNodeId"], "The gateway sits at the top of the space"
    assert_includes inside["relationships"].map { |r| r["relationshipType"] }, "writes_to"
  end

  test "containment edges never produce a neighbour" do
    # Every node on a level has a `contains` edge to its parent and to each of its
    # children, all of them off-level. Following those would put back exactly the nodes
    # the level scoping just removed.
    assert_empty fetch_graph(focusNodeId: @orders.id.to_s)["neighbors"]
    assert_empty fetch_graph["neighbors"]
  end

  test "exposes the public id, never the database id" do
    result = execute_graphql(<<~GQL, variables: { id: @space.public_id }, user: @user)
      query($id: ID!) { documentationSpace(id: $id) { id name } }
    GQL

    assert_equal @space.public_id, result.dig("data", "documentationSpace", "id")
    assert_not_equal @space.id.to_s, result.dig("data", "documentationSpace", "id")
  end

  test "filtering by layer drops nodes and the edges that lose an endpoint" do
    graph = fetch_graph(layerId: @services.id.to_s)

    assert_equal 2, graph["nodeCount"]
    assert_equal %w[calls], graph["relationships"].map { |r| r["relationshipType"] },
                 "The contains edge points at a node outside the layer and must not be returned"
  end

  test "a truncated graph says so and stays internally consistent" do
    graph = fetch_graph(limit: 1)

    assert graph["truncated"], "The client has to know it is looking at part of a graph"
    assert_equal 1, graph["nodes"].size
    assert_equal 2, graph["nodeCount"], "nodeCount reports the match, not the page"

    # Every edge still has both ends drawable: either both on the canvas, or one on it
    # and the other among the neighbours. An edge to a node the client was never given
    # is the one thing a graph slice must not contain.
    drawable = (graph["nodes"] + graph["neighbors"]).map { |node| node["id"] }
    graph["relationships"].each do |relationship|
      assert_includes drawable, relationship["sourceNodeId"]
      assert_includes drawable, relationship["targetNodeId"]
    end
  end

  test "a node resolves its content, its layer and both edge directions" do
    create_block(node: @orders, block_type: "markdown", data: { "markdown" => "# Orders" })

    result = execute_graphql(<<~GQL, variables: { id: @orders.id.to_s }, user: @user)
      query($id: ID!) {
        node(id: $id) {
          title
          layer { name }
          contentBlocks { blockType data }
          outgoingRelationships { relationshipType targetNode { title } }
          incomingRelationships { relationshipType sourceNode { title } }
        }
      }
    GQL

    assert_no_graphql_errors(result)
    node = result.dig("data", "node")

    assert_equal "Services", node.dig("layer", "name")
    assert_equal "MARKDOWN", node.dig("contentBlocks", 0, "blockType")
    assert_equal "orders table", node.dig("outgoingRelationships", 0, "targetNode", "title")
    assert_equal "API Gateway", node.dig("incomingRelationships", 0, "sourceNode", "title")
  end

  test "the spaces connection is scoped to the caller" do
    create_space(user: create_user, name: "Someone else's")

    result = execute_graphql(<<~GQL, user: @user)
      query { documentationSpaces(first: 10) { totalCount nodes { name } } }
    GQL

    assert_equal 1, result.dig("data", "documentationSpaces", "totalCount")
    assert_equal [ "Platform" ], result.dig("data", "documentationSpaces", "nodes").map { |s| s["name"] }
  end

  test "resolving a whole graph does not issue a query per node" do
    # The guard against the N+1 the dataloaders exist to prevent. Ten nodes with content
    # and edges must not cost thirty round trips.
    10.times do |i|
      node = create_node(space: @space, title: "Service #{i}")
      create_block(node: node)
      create_relationship(source: @gateway, target: node, relationship_type: "calls")
    end

    queries = count_queries do
      execute_graphql(<<~GQL, variables: { id: @space.public_id }, user: @user)
        query($id: ID!) {
          documentationSpace(id: $id) {
            graph {
              nodes { title layer { name } contentBlocks { blockType } outgoingRelationships { id } }
            }
          }
        }
      GQL
    end

    assert_operator queries, :<, 15, "Expected batched loads, got #{queries} queries"
  end

  private

  def fetch_graph(**arguments)
    result = execute_graphql(<<~GQL, variables: { id: @space.public_id, **arguments }, user: @user)
      query($id: ID!, $layerId: ID, $limit: Int, $focusNodeId: ID) {
        documentationSpace(id: $id) {
          graph(layerId: $layerId, limit: $limit, focusNodeId: $focusNodeId) {
            nodeCount
            relationshipCount
            truncated
            nodes { id title }
            neighbors { id title parentNodeId }
            relationships { relationshipType sourceNodeId targetNodeId }
          }
        }
      }
    GQL

    assert_no_graphql_errors(result)
    result.dig("data", "documentationSpace", "graph")
  end

  def count_queries
    count = 0
    counter = ->(_name, _start, _finish, _id, payload) do
      count += 1 unless payload[:name] == "SCHEMA" || payload[:sql].start_with?("BEGIN", "COMMIT")
    end

    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }

    count
  end
end
