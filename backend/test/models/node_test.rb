# frozen_string_literal: true

require "test_helper"

class NodeTest < ActiveSupport::TestCase
  setup do
    @space = create_space
  end

  test "starts at the origin with a default size" do
    node = create_node(space: @space)

    assert_equal [ 0.0, 0.0, 0.0 ], [ node.x, node.y, node.z ]
    assert_operator node.width, :>, 0
  end

  test "requires a title and a type" do
    node = @space.nodes.new(node_type: "")

    assert_not node.valid?
    assert_includes node.errors[:title], "can't be blank"
    assert_includes node.errors[:node_type], "can't be blank"
  end

  test "accepts a node type outside the suggested vocabulary" do
    # The open set is the point: a team must be able to document a kind of thing nobody
    # anticipated without a migration or a deploy.
    node = create_node(space: @space, node_type: "regulatory_control")

    assert_predicate node, :persisted?
    assert_not_includes Node::SUGGESTED_TYPES, "regulatory_control"
  end

  test "rejects coordinates beyond the limit" do
    node = @space.nodes.new(title: "Far away", x: Node::COORDINATE_LIMIT + 1, y: 0, z: 0)

    assert_not node.valid?
    assert_predicate node.errors[:x], :any?
  end

  test "rejects metadata that is not an object" do
    node = @space.nodes.new(title: "Bad metadata", metadata: "nope")

    assert_not node.valid?
    assert_includes node.errors[:metadata], "must be a JSON object"
  end

  test "rejects a layer from another space" do
    foreign_layer = create_layer(space: create_space)
    node = @space.nodes.new(title: "Wrong layer", layer: foreign_layer)

    assert_not node.valid?
    assert_includes node.errors[:layer], "must belong to the same documentation space"
  end

  test "losing its layer nullifies rather than deletes the node" do
    layer = create_layer(space: @space)
    node = create_node(space: @space, layer: layer)

    layer.destroy!

    assert_predicate node.reload, :persisted?
    assert_nil node.layer_id
  end

  test "the within scope answers a viewport query" do
    inside = create_node(space: @space, x: 10, y: 10)
    create_node(space: @space, x: 5_000, y: 5_000)

    assert_equal [ inside.id ], @space.nodes.within(-100, -100, 100, 100).pluck(:id)
  end

  test "full-text search matches the title and stems" do
    node = create_node(space: @space, title: "Payment Service", summary: "Captures money")
    create_node(space: @space, title: "Catalog Service")

    assert_equal [ node.id ], @space.nodes.matching("payments").pluck(:id)
    assert_equal [ node.id ], @space.nodes.matching("capturing").pluck(:id)
  end

  test "a malformed search query does not raise" do
    create_node(space: @space, title: "Payment Service")

    # websearch_to_tsquery is chosen over to_tsquery precisely because a search box fires
    # on every keystroke and half-typed input must not be a 500.
    assert_nothing_raised { @space.nodes.matching("&& !! ((").to_a }
  end

  test "destroying a node destroys its blocks and every edge touching it" do
    node = create_node(space: @space)
    other = create_node(space: @space)
    create_relationship(source: node, target: other)
    create_relationship(source: other, target: node, relationship_type: "depends_on")
    create_block(node: node)

    assert_difference "NodeRelationship.count", -2 do
      assert_difference "ContentBlock.count", -1 do
        node.destroy!
      end
    end

    assert_predicate other.reload, :persisted?
  end
end
