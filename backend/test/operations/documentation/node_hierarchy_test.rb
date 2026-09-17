# frozen_string_literal: true

require "test_helper"

# The operations that change where a node lives, copy it, or remove it.
#
# Grouped in one file because they share a question -- what happens to the nodes inside
# this one -- and the answers only make sense next to each other.
class Documentation::NodeHierarchyTest < ActiveSupport::TestCase
  setup do
    @user = create_user
    @space = create_space(user: @user, name: "Platform")

    @platform = create_node(space: @space, title: "Platform")
    @orders = create_node(space: @space, title: "Order Service")
    @table = create_node(space: @space, title: "orders table")

    contain(@platform, @orders)
    contain(@orders, @table)
  end

  # --- Moving -----------------------------------------------------------

  test "moving a node out of one parent and into another is a single change" do
    billing = create_node(space: @space, title: "Billing Service")
    contain(@platform, billing)

    Documentation::ReparentNode.call(
      node: @table,
      new_parent_id: billing.id,
      from_parent_id: @orders.id,
      actor: @user
    )

    assert_equal [ billing.id ], parent_ids_of(@table)
  end

  test "a node can be filed in an additional place without leaving the first" do
    billing = create_node(space: @space, title: "Billing Service")

    # No `from_parent_id`: this is "also lives here", which is the case the many-to-many
    # containment exists for.
    Documentation::ReparentNode.call(node: @table, new_parent_id: billing.id, actor: @user)

    assert_equal [ @orders.id, billing.id ].sort, parent_ids_of(@table).sort
  end

  test "moving a node with no new parent takes it to the top of the space" do
    Documentation::ReparentNode.call(node: @orders, from_parent_id: @platform.id, actor: @user)

    assert_empty parent_ids_of(@orders)
  end

  test "a node cannot be moved inside something it contains" do
    error = assert_raises ApplicationGraphql::ValidationError do
      Documentation::ReparentNode.call(node: @platform, new_parent_id: @table.id, actor: @user)
    end

    assert_match "cannot also contain it", error.message
    assert_equal [ @orders.id ], parent_ids_of(@table), "The rejected move must not have written anything"
  end

  test "a node cannot be moved inside itself" do
    assert_raises ApplicationGraphql::ValidationError do
      Documentation::ReparentNode.call(node: @orders, new_parent_id: @orders.id, actor: @user)
    end
  end

  test "moving a node somewhere it already is changes nothing and does not fail" do
    Documentation::ReparentNode.call(node: @table, new_parent_id: @orders.id, actor: @user)

    assert_equal [ @orders.id ], parent_ids_of(@table)
  end

  # --- Copying ----------------------------------------------------------

  test "copying a node brings its documentation and leaves its contents behind" do
    create_block(node: @orders, block_type: "markdown", data: { "markdown" => "# Orders" })

    copy = Documentation::CloneNode.call(node: @orders, actor: @user)

    assert_equal "Order Service copy", copy.title
    assert_equal [ "markdown" ], copy.content_blocks.map(&:block_type)
    assert_equal [ @platform.id ], parent_ids_of(copy), "A copy belongs beside the original"
    assert_empty child_ids_of(copy)
  end

  test "copying a node with its contents reproduces the structure, not the surroundings" do
    create_relationship(source: @table, target: @orders, relationship_type: "writes_to")
    outside = create_node(space: @space, title: "Search Service")
    create_relationship(source: @orders, target: outside, relationship_type: "calls")

    copy = Documentation::CloneNode.call(node: @orders, include_children: true, actor: @user)

    copied_children = child_ids_of(copy)
    assert_equal 1, copied_children.size
    assert_not_includes copied_children, @table.id, "The copy must contain a new node, not the original"
    assert_equal "orders table", Node.find(copied_children.first).title

    # The edge inside the copied set came along; the one leaving it did not.
    assert edge?(copied_children.first, copy.id, "writes_to")
    assert_not edge?(copy.id, outside.id, "calls"),
               "A copy must not claim the original's dependencies on nodes it did not copy"
  end

  # --- Deleting ---------------------------------------------------------

  test "deleting a node moves the nodes inside it up to where it was" do
    Documentation::DeleteNode.call(node: @orders, actor: @user)

    assert_nil Node.find_by(id: @orders.id)
    assert_equal [ @platform.id ], parent_ids_of(@table),
                 "Work filed under a grouping must survive the grouping, in its place"
  end

  test "deleting a node with cascade takes everything inside it" do
    Documentation::DeleteNode.call(node: @orders, cascade: true, actor: @user)

    assert_nil Node.find_by(id: @orders.id)
    assert_nil Node.find_by(id: @table.id)
    assert Node.exists?(@platform.id)
  end

  test "a cascading delete spares a node that also lives somewhere else" do
    billing = create_node(space: @space, title: "Billing Service")
    contain(billing, @table)

    Documentation::DeleteNode.call(node: @orders, cascade: true, actor: @user)

    assert Node.exists?(@table.id), "It still lives inside Billing, so it is not gone"
    assert_equal [ billing.id ], parent_ids_of(@table)
  end

  test "the deletion impact names what would go and what would stay" do
    billing = create_node(space: @space, title: "Billing Service")
    shared = create_node(space: @space, title: "users table")
    contain(@orders, shared)
    contain(billing, shared)
    create_block(node: @table)

    impact = Documentation::DeletionImpact.call(node: @orders)

    assert_equal [ "orders table" ], impact.descendants.map(&:title)
    assert_equal [ "users table" ], impact.retained.map(&:title)
    # The node's own content and its descendants' are counted apart, because only one
    # button removes the second kind.
    assert_equal 0, impact.block_count
    assert_equal 1, impact.descendant_block_count
  end

  test "the deletion impact says what every edge is, not how many there are" do
    gateway = create_node(space: @space, title: "Payments Gateway")
    create_relationship(source: gateway, target: @orders, relationship_type: "calls")

    impact = Documentation::DeletionImpact.call(node: @orders)

    # A confirmation has to be readable without resolving ids: both ends and the verb.
    assert_equal(
      [
        [ "calls", "Payments Gateway", "Order Service" ],
        [ "contains", "Platform", "Order Service" ],
        [ "contains", "Order Service", "orders table" ],
      ].sort,
      impact.relationships.map { |edge| [ edge.relationship_type, edge.source_title, edge.target_title ] }.sort
    )
    assert_equal 3, impact.relationship_count
  end

  private

  def contain(parent, child)
    create_relationship(source: parent, target: child, relationship_type: "contains")
  end

  def parent_ids_of(node)
    @space.node_relationships
          .where(target_node_id: node.id, relationship_type: "contains")
          .pluck(:source_node_id)
  end

  def child_ids_of(node)
    @space.node_relationships
          .where(source_node_id: node.id, relationship_type: "contains")
          .pluck(:target_node_id)
  end

  def edge?(source_id, target_id, type)
    @space.node_relationships.exists?(source_node_id: source_id, target_node_id: target_id, relationship_type: type)
  end
end
