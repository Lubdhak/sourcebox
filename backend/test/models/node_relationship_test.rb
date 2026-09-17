# frozen_string_literal: true

require "test_helper"

class NodeRelationshipTest < ActiveSupport::TestCase
  setup do
    @space = create_space
    @source = create_node(space: @space, title: "API Gateway")
    @target = create_node(space: @space, title: "Order Service")
  end

  test "connects two nodes and infers the space from the source" do
    relationship = NodeRelationship.create!(
      source_node: @source,
      target_node: @target,
      relationship_type: "calls"
    )

    assert_equal @space.id, relationship.documentation_space_id
  end

  test "rejects a self-referential edge" do
    relationship = NodeRelationship.new(
      documentation_space: @space,
      source_node: @source,
      target_node: @source,
      relationship_type: "calls"
    )

    assert_not relationship.valid?
    assert_includes relationship.errors[:target_node], "must be a different node"
  end

  test "rejects an edge spanning two spaces" do
    # The rule that matters most: edges are loaded by space and authorization is checked
    # at the space, so a cross-space edge would pull another user's node onto a canvas
    # they are entitled to see.
    foreign = create_node(space: create_space)

    relationship = NodeRelationship.new(
      documentation_space: @space,
      source_node: @source,
      target_node: foreign,
      relationship_type: "calls"
    )

    assert_not relationship.valid?
    assert_includes relationship.errors[:target_node],
                    "must belong to the same documentation space as the source"
  end

  test "rejects a space that disagrees with its endpoints" do
    relationship = NodeRelationship.new(
      documentation_space: create_space,
      source_node: @source,
      target_node: @target,
      relationship_type: "calls"
    )

    assert_not relationship.valid?
    assert_includes relationship.errors[:documentation_space], "must match the space of both endpoints"
  end

  test "the same pair may be connected by different verbs but not twice by one" do
    create_relationship(source: @source, target: @target, relationship_type: "calls")

    assert_nothing_raised do
      create_relationship(source: @source, target: @target, relationship_type: "depends_on")
    end

    duplicate = NodeRelationship.new(
      documentation_space: @space,
      source_node: @source,
      target_node: @target,
      relationship_type: "calls"
    )

    assert_not duplicate.valid?
    assert_includes duplicate.errors[:source_node_id],
                    "already has a relationship of this type to that node"
  end

  test "direction is meaningful: A calls B is not B calls A" do
    create_relationship(source: @source, target: @target, relationship_type: "calls")

    assert_nothing_raised do
      create_relationship(source: @target, target: @source, relationship_type: "calls")
    end
  end

  test "rejects a relationship type that is not a lowercase identifier" do
    relationship = NodeRelationship.new(
      documentation_space: @space,
      source_node: @source,
      target_node: @target,
      relationship_type: "Calls Loudly"
    )

    assert_not relationship.valid?
    assert_predicate relationship.errors[:relationship_type], :any?
  end

  test "accepts a verb outside the suggested vocabulary" do
    relationship = create_relationship(source: @source, target: @target, relationship_type: "mitigates")

    assert_predicate relationship, :persisted?
    assert_not_includes NodeRelationship::SUGGESTED_TYPES, "mitigates"
  end

  test "for_nodes finds edges in both directions" do
    outgoing = create_relationship(source: @source, target: @target)
    incoming = create_relationship(source: @target, target: @source, relationship_type: "depends_on")

    assert_equal [ outgoing.id, incoming.id ].sort,
                 NodeRelationship.for_nodes([ @source.id ]).pluck(:id).sort
  end
end
