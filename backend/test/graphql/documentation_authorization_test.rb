# frozen_string_literal: true

require "test_helper"

# The test the plan called the main risk of this feature.
#
# Space-scoped authorization is new, every child entity is addressed by a sequential id,
# and a single resolver that forgets to route through its space is an IDOR. So every
# entry point that takes a node, edge or block id is exercised here against a space its
# caller does not own, and every one of them must answer NOT_FOUND -- not FORBIDDEN, which
# would confirm the id exists.
class Documentation::AuthorizationTest < ActiveSupport::TestCase
  setup do
    @owner = create_user
    @intruder = create_user

    @space = create_space(user: @owner)
    @node = create_node(space: @space, title: "Payment Service")
    @other_node = create_node(space: @space, title: "Order Service")
    @relationship = create_relationship(source: @node, target: @other_node)
    @block = create_block(node: @node)
  end

  test "reading a space the caller does not own is not found" do
    result = execute_graphql(<<~GQL, variables: { id: @space.public_id }, user: @intruder)
      query($id: ID!) { documentationSpace(id: $id) { name } }
    GQL

    assert_graphql_error(result, "NOT_FOUND")
  end

  test "a space that does not exist is reported identically" do
    missing = execute_graphql(<<~GQL, variables: { id: SecureRandom.uuid }, user: @owner)
      query($id: ID!) { documentationSpace(id: $id) { name } }
    GQL

    forbidden = execute_graphql(<<~GQL, variables: { id: @space.public_id }, user: @intruder)
      query($id: ID!) { documentationSpace(id: $id) { name } }
    GQL

    # Identical responses are the whole point. Any difference turns this field into an
    # oracle for which spaces exist.
    assert_equal forbidden["errors"], missing["errors"]
  end

  test "a malformed space id is not found rather than a server error" do
    result = execute_graphql(<<~GQL, variables: { id: "not-a-uuid" }, user: @owner)
      query($id: ID!) { documentationSpace(id: $id) { name } }
    GQL

    assert_graphql_error(result, "NOT_FOUND")
  end

  test "reading a node through its space is denied to everyone else" do
    result = execute_graphql(<<~GQL, variables: { id: @node.id.to_s }, user: @intruder)
      query($id: ID!) { node(id: $id) { title contentBlocks { data } } }
    GQL

    assert_graphql_error(result, "NOT_FOUND")
  end

  test "searching another user's space is denied" do
    result = execute_graphql(<<~GQL, variables: { spaceId: @space.public_id, query: "payment" }, user: @intruder)
      query($spaceId: ID!, $query: String!) {
        searchDocumentation(spaceId: $spaceId, query: $query) { node { title } }
      }
    GQL

    assert_graphql_error(result, "NOT_FOUND")
  end

  test "every mutation entry point refuses a foreign id" do
    mutations = {
      "createNode" => [
        "mutation($i: CreateNodeInput!) { createNode(input: $i) { node { id } } }",
        { i: { spaceId: @space.public_id, title: "Injected" } },
      ],
      "updateNode" => [
        "mutation($i: UpdateNodeInput!) { updateNode(input: $i) { node { id } } }",
        { i: { nodeId: @node.id.to_s, title: "Renamed" } },
      ],
      "moveNodes" => [
        "mutation($i: MoveNodesInput!) { moveNodes(input: $i) { nodes { id } } }",
        { i: { spaceId: @space.public_id, positions: [ { nodeId: @node.id.to_s, x: 1.0, y: 1.0 } ] } },
      ],
      "deleteNode" => [
        "mutation($i: DeleteNodeInput!) { deleteNode(input: $i) { deletedNodeId } }",
        { i: { nodeId: @node.id.to_s } },
      ],
      "createRelationship" => [
        "mutation($i: CreateRelationshipInput!) { createRelationship(input: $i) { relationship { id } } }",
        { i: { spaceId: @space.public_id, sourceNodeId: @node.id.to_s,
               targetNodeId: @other_node.id.to_s, relationshipType: "calls" } },
      ],
      "deleteRelationship" => [
        "mutation($i: DeleteRelationshipInput!) { deleteRelationship(input: $i) { deletedRelationshipId } }",
        { i: { relationshipId: @relationship.id.to_s } },
      ],
      "upsertContentBlock" => [
        "mutation($i: UpsertContentBlockInput!) { upsertContentBlock(input: $i) { contentBlock { id } } }",
        { i: { nodeId: @node.id.to_s, blockType: "TEXT", data: { text: "injected" } } },
      ],
      "deleteContentBlock" => [
        "mutation($i: DeleteContentBlockInput!) { deleteContentBlock(input: $i) { deletedBlockId } }",
        { i: { blockId: @block.id.to_s } },
      ],
    }

    mutations.each do |name, (query, variables)|
      result = execute_graphql(query, variables: variables, user: @intruder)

      assert_graphql_error(result, "NOT_FOUND", "Not found.")
      assert_nil result.dig("data", name), "#{name} returned data to a user who does not own the space"
    end

    # And nothing was actually written.
    assert_equal "Payment Service", @node.reload.title
    assert_equal 2, @space.nodes.count
    assert_predicate @block.reload, :persisted?
  end

  test "an anonymous caller is unauthenticated rather than not found" do
    result = execute_graphql(<<~GQL, variables: { id: @space.public_id }, user: nil)
      query($id: ID!) { documentationSpace(id: $id) { name } }
    GQL

    # A different code on purpose: "sign in" is actionable and leaks nothing, because it
    # is the answer for every id.
    assert_graphql_error(result, "UNAUTHENTICATED")
  end

  test "a relationship cannot be created between spaces the caller owns separately" do
    # Owning both spaces is not enough: an edge spanning two of them would break the
    # assumption that a space's edges only reference its own nodes.
    other_space = create_space(user: @owner)
    foreign_node = create_node(space: other_space)

    variables = {
      i: { spaceId: @space.public_id, sourceNodeId: @node.id.to_s,
           targetNodeId: foreign_node.id.to_s, relationshipType: "calls" },
    }

    result = execute_graphql(<<~GQL, variables: variables, user: @owner)
      mutation($i: CreateRelationshipInput!) { createRelationship(input: $i) { relationship { id } } }
    GQL

    assert_graphql_error(result, "VALIDATION_FAILED")
    assert_equal 0, NodeRelationship.where(target_node_id: foreign_node.id).count
  end
end
