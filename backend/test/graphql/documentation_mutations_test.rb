# frozen_string_literal: true

require "test_helper"

class Documentation::MutationsTest < ActiveSupport::TestCase
  setup do
    @user = create_user
    @space = create_space(user: @user)
    @layer = create_layer(space: @space, index: 0, name: "System")
  end

  test "createDocumentationSpace creates the default layers" do
    result = execute_graphql(<<~GQL, variables: { i: { name: "New Platform" } }, user: @user)
      mutation($i: CreateDocumentationSpaceInput!) {
        createDocumentationSpace(input: $i) {
          documentationSpace { id name slug layers { index name } }
        }
      }
    GQL

    assert_no_graphql_errors(result)
    space = result.dig("data", "createDocumentationSpace", "documentationSpace")

    assert_equal "new-platform", space["slug"]
    # One rung, not a guessed hierarchy. Depth is provisioned as nodes are nested, so a
    # brand new space claiming five depths would be describing a decomposition its
    # author has not made yet.
    assert_equal [ 0 ], space["layers"].map { |layer| layer["index"] }
  end

  test "createNode places it, layers it, and creates its content and parent edge at once" do
    parent = create_node(space: @space, title: "Platform")

    variables = {
      i: {
        spaceId: @space.public_id,
        title: "Payment Service",
        nodeType: "service",
        x: 120.0, y: -40.0,
        layerId: @layer.id.to_s,
        parentNodeId: parent.id.to_s,
        blocks: [ { blockType: "MARKDOWN", data: { markdown: "# Payments" } } ],
      },
    }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: CreateNodeInput!) {
        createNode(input: $i) {
          node { id title nodeType layerId position { x y z } contentBlocks { blockType } }
        }
      }
    GQL

    assert_no_graphql_errors(result)
    node = result.dig("data", "createNode", "node")

    assert_equal "Payment Service", node["title"]
    assert_equal({ "x" => 120.0, "y" => -40.0, "z" => 0.0 }, node["position"])
    assert_equal @layer.id.to_s, node["layerId"]
    assert_equal [ "MARKDOWN" ], node["contentBlocks"].map { |block| block["blockType"] }

    edge = NodeRelationship.find_by(source_node_id: parent.id, target_node_id: node["id"])
    assert_equal "contains", edge.relationship_type
  end

  test "createNode rolls the whole thing back when a block is invalid" do
    # One user gesture, one transaction. A failure must not leave a titled node with no
    # content behind.
    variables = {
      i: { spaceId: @space.public_id, title: "Half a node",
           blocks: [ { blockType: "TABLE", data: { columns: [ "a" ] } } ] },
    }

    assert_no_difference "Node.count" do
      result = execute_graphql(<<~GQL, variables: variables, user: @user)
        mutation($i: CreateNodeInput!) { createNode(input: $i) { node { id } } }
      GQL

      assert_graphql_error(result, "VALIDATION_FAILED")
    end
  end

  test "updateNode changes only what was sent and merges metadata" do
    node = create_node(space: @space, title: "Original", summary: "Original summary",
                       metadata: { "team" => "platform", "status" => "live" })

    variables = { i: { nodeId: node.id.to_s, title: "Renamed", metadata: { status: "deprecated" } } }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: UpdateNodeInput!) { updateNode(input: $i) { node { title summary metadata } } }
    GQL

    assert_no_graphql_errors(result)
    updated = result.dig("data", "updateNode", "node")

    assert_equal "Renamed", updated["title"]
    assert_equal "Original summary", updated["summary"], "An omitted field must be left alone"
    assert_equal({ "team" => "platform", "status" => "deprecated" }, updated["metadata"],
                 "Metadata merges key-by-key so one client cannot wipe another's keys")
  end

  test "updateNode can clear a node's layer with an explicit null" do
    node = create_node(space: @space, layer: @layer)

    result = execute_graphql(<<~GQL, variables: { i: { nodeId: node.id.to_s, layerId: nil } }, user: @user)
      mutation($i: UpdateNodeInput!) { updateNode(input: $i) { node { layerId } } }
    GQL

    assert_no_graphql_errors(result)
    assert_nil result.dig("data", "updateNode", "node", "layerId")
  end

  test "createRelationship is idempotent" do
    source = create_node(space: @space)
    target = create_node(space: @space)

    first = create_edge(source, target)
    second = create_edge(source, target)

    assert_no_graphql_errors(second)
    assert_equal first.dig("data", "createRelationship", "relationship", "id"),
                 second.dig("data", "createRelationship", "relationship", "id"),
                 "Re-sending an edge an optimistic client already drew must not be an error"
    assert_equal 1, NodeRelationship.where(source_node_id: source.id).count
  end

  test "createRelationship refuses a self-edge" do
    node = create_node(space: @space)

    result = create_edge(node, node)

    assert_predicate result["errors"], :present?
    assert_equal 0, NodeRelationship.count
  end

  test "deleteNodes hard-deletes content and edges and returns the ids" do
    node = create_node(space: @space)
    other = create_node(space: @space)
    create_relationship(source: node, target: other)
    create_block(node: node)

    variables = { i: { nodeIds: [ node.id.to_s ], deletionMode: "HARD" } }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: DeleteNodesInput!) {
        deleteNodes(input: $i) { deletedNodeIds changed }
      }
    GQL

    assert_no_graphql_errors(result)
    assert_equal [ node.id.to_s ], result.dig("data", "deleteNodes", "deletedNodeIds")
    assert_equal false, result.dig("data", "deleteNodes", "changed")
    assert_equal 0, NodeRelationship.count
    assert_equal 0, ContentBlock.count
    assert_predicate other.reload, :persisted?
  end

  test "deleteNodes takes one node and many through the same field" do
    first = create_node(space: @space, title: "First")
    second = create_node(space: @space, title: "Second")

    variables = { i: { nodeIds: [ first.id.to_s, second.id.to_s ], deletionMode: "HARD" } }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: DeleteNodesInput!) { deleteNodes(input: $i) { deletedNodeIds } }
    GQL

    assert_no_graphql_errors(result)
    assert_equal 2, result.dig("data", "deleteNodes", "deletedNodeIds").size
    assert_nil Node.find_by(id: first.id)
    assert_nil Node.find_by(id: second.id)
  end

  test "deleteNodes defaults to a recoverable delete" do
    node = create_node(space: @space)

    result = execute_graphql(<<~GQL, variables: { i: { nodeIds: [ node.id.to_s ] } }, user: @user)
      mutation($i: DeleteNodesInput!) { deleteNodes(input: $i) { deletedNodeIds } }
    GQL

    assert_no_graphql_errors(result)
    # Gone from every read path, still on disk.
    assert_nil Node.find_by(id: node.id)
    assert_predicate Node.with_deleted.find(node.id), :deleted?
  end

  test "deleteNodes refuses a stale confirmation instead of deleting the wrong set" do
    node = create_node(space: @space)

    variables = { i: { nodeIds: [ node.id.to_s ], expectedDigest: "a-digest-from-another-graph" } }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: DeleteNodesInput!) {
        deleteNodes(input: $i) { deletedNodeIds changed impact { digest deleteCount } }
      }
    GQL

    assert_no_graphql_errors(result)
    assert_equal true, result.dig("data", "deleteNodes", "changed")
    assert_nil result.dig("data", "deleteNodes", "deletedNodeIds")
    # The fresh impact comes back so the dialog can redraw rather than fail.
    assert_predicate result.dig("data", "deleteNodes", "impact", "digest"), :present?
    assert_predicate node.reload, :persisted?
  end

  test "nodesDeletionImpact reports the same shape for one node and for many" do
    parent = create_node(space: @space, title: "Platform")
    child = create_node(space: @space, title: "Order Service")
    create_relationship(source: parent, target: child, relationship_type: "contains")

    variables = { ids: [ parent.id.to_s ], orphanPolicy: "DELETE" }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      query($ids: [ID!]!, $orphanPolicy: OrphanPolicy) {
        nodesDeletionImpact(nodeIds: $ids, orphanPolicy: $orphanPolicy) {
          digest
          selectedCount
          orphanCount
          deleteCount
          additionalDeleteCount
          orphans { id title reason }
        }
      }
    GQL

    assert_no_graphql_errors(result)
    impact = result.dig("data", "nodesDeletionImpact")

    assert_equal 1, impact["selectedCount"]
    assert_equal 1, impact["orphanCount"]
    # Deleting the disconnected node too means two rows go, not one.
    assert_equal 2, impact["deleteCount"]
    assert_equal 1, impact["additionalDeleteCount"]
    assert_equal "Order Service", impact.dig("orphans", 0, "title")
    assert_predicate impact.dig("orphans", 0, "reason"), :present?
  end

  test "upsertContentBlock returns the node so the client sees renumbered siblings" do
    node = create_node(space: @space)
    first = create_block(node: node, block_type: "text")

    variables = { i: { nodeId: node.id.to_s, blockType: "CODE", data: { code: "puts 1" }, position: 0 } }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: UpsertContentBlockInput!) {
        upsertContentBlock(input: $i) {
          contentBlock { id blockType position }
          node { contentBlocks { id position } }
        }
      }
    GQL

    assert_no_graphql_errors(result)
    blocks = result.dig("data", "upsertContentBlock", "node", "contentBlocks")

    assert_equal [ 0, 1 ], blocks.map { |block| block["position"] }
    assert_equal first.id.to_s, blocks.last["id"], "The existing block should have been pushed down"
  end

  test "a payload that does not match its block type is a field error, not a crash" do
    node = create_node(space: @space)

    variables = { i: { nodeId: node.id.to_s, blockType: "TABLE", data: { columns: [ "a" ] } } }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: UpsertContentBlockInput!) { upsertContentBlock(input: $i) { contentBlock { id } } }
    GQL

    assert_graphql_error(result, "VALIDATION_FAILED")

    # The per-field detail the client needs to mark the right input, rather than a bare
    # message it would have to parse.
    fields = result.dig("errors", 0, "extensions", "fields").transform_keys(&:to_s)
    assert_equal [ "must include rows" ], fields["data"]
  end

  test "an unknown block type is rejected during query validation" do
    node = create_node(space: @space)

    variables = { i: { nodeId: node.id.to_s, blockType: "HOLOGRAM", data: {} } }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: UpsertContentBlockInput!) { upsertContentBlock(input: $i) { contentBlock { id } } }
    GQL

    # The payoff for making blockType an enum rather than a String: this never reaches
    # application code.
    assert_predicate result["errors"], :present?
    assert_match(/HOLOGRAM/, result.dig("errors", 0, "message"))
  end

  test "moveNodes persists a batch and returns the server's coordinates" do
    first = create_node(space: @space)
    second = create_node(space: @space)

    variables = {
      i: { spaceId: @space.public_id, positions: [
        { nodeId: first.id.to_s, x: 10.0, y: 20.0, z: 1.0 },
        { nodeId: second.id.to_s, x: -5.0, y: 0.0 },
      ] },
    }

    result = execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: MoveNodesInput!) { moveNodes(input: $i) { nodes { id position { x y z } } } }
    GQL

    assert_no_graphql_errors(result)
    positions = result.dig("data", "moveNodes", "nodes").to_h { |node| [ node["id"], node["position"] ] }

    assert_equal({ "x" => 10.0, "y" => 20.0, "z" => 1.0 }, positions[first.id.to_s])
    assert_equal({ "x" => -5.0, "y" => 0.0, "z" => 0.0 }, positions[second.id.to_s])
  end

  private

  def create_edge(source, target, relationship_type: "calls")
    variables = {
      i: { spaceId: @space.public_id, sourceNodeId: source.id.to_s,
           targetNodeId: target.id.to_s, relationshipType: relationship_type },
    }

    execute_graphql(<<~GQL, variables: variables, user: @user)
      mutation($i: CreateRelationshipInput!) {
        createRelationship(input: $i) { relationship { id relationshipType } }
      }
    GQL
  end
end
