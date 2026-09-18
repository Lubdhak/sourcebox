# frozen_string_literal: true

require "test_helper"

# The deletion policy matrix, and the promise that the preview and the execution describe
# the same operation.
#
# Deliberately not split by "single" and "bulk": the service has no branch on selection
# size, so a test suite organised that way would be testing the same code twice and
# implying a distinction that does not exist. One test states it explicitly instead.
class NodeDeletionTest < ActiveSupport::TestCase
  include DocumentationFactories

  setup do
    @user = create_user
    @space = create_space(user: @user)

    # Platform ─contains→ Orders ─contains→ orders table
    @platform = create_node(space: @space, title: "Platform")
    @orders = create_node(space: @space, title: "Order Service")
    @table = create_node(space: @space, title: "orders table")
    contain(@platform, @orders)
    contain(@orders, @table)
  end

  # --- What gets deleted ------------------------------------------------

  test "soft deletion hides the node but keeps the row" do
    run(@orders, mode: "soft")

    assert_nil Node.find_by(id: @orders.id), "It must be gone from every ordinary read"
    assert_predicate Node.with_deleted.find(@orders.id), :deleted?
    assert_equal @user.id, Node.with_deleted.find(@orders.id).deleted_by_id
  end

  test "hard deletion destroys the row and its content" do
    create_block(node: @orders)

    run(@orders, mode: "hard")

    assert_nil Node.with_deleted.find_by(id: @orders.id)
    assert_equal 0, ContentBlock.where(node_id: @orders.id).count
  end

  test "keeping the disconnected nodes re-homes them one level up" do
    run(@orders, orphan_policy: "keep")

    assert_equal [ @platform.id ], parent_ids_of(@table),
                 "Work filed under a grouping survives the grouping, in its place"
  end

  test "deleting the disconnected nodes takes them too" do
    impact = run(@orders, mode: "hard", orphan_policy: "delete")

    assert_equal 2, impact.deleted_ids.size
    assert_nil Node.with_deleted.find_by(id: @table.id)
  end

  test "a node filed in two places is never disconnected by losing one parent" do
    billing = create_node(space: @space, title: "Billing")
    contain(billing, @table)

    impact = preview(@orders, orphan_policy: "delete")

    assert_empty impact.orphans.map(&:title)
    assert_equal [ "orders table" ], impact.retained.map(&:title)

    run(@orders, mode: "hard", orphan_policy: "delete")
    assert Node.exists?(@table.id), "It still lives inside Billing"
  end

  test "one node and several take the identical path" do
    other = create_node(space: @space, title: "Search Service")

    single = preview(@orders)
    many = Documentation::NodeDeletion.new(
      nodes: [ @orders, other ],
      policy: Documentation::DeletionPolicy.new,
      actor: @user
    ).impact

    assert_equal 1, single.selected_count
    assert_equal 2, many.selected_count
    # Same structure, same fields, one implementation.
    assert_equal single.to_h.keys, many.to_h.keys
  end

  # --- References -------------------------------------------------------

  test "the impact names both kinds of reference as one list" do
    gateway = create_node(space: @space, title: "Payments Gateway")
    create_relationship(source: gateway, target: @orders, relationship_type: "calls")

    mentioner = create_node(space: @space, title: "Runbook")
    create_block(
      node: mentioner,
      block_type: "markdown",
      data: { "markdown" => "See [@Order Service](#node-#{@orders.id}) for details." }
    )

    impact = preview(@orders)

    kinds = impact.references.map(&:kind).sort
    assert_equal %w[calls mention], kinds
    assert_includes impact.references.map(&:source_title), "Payments Gateway"
    assert_includes impact.references.map(&:source_title), "Runbook"
  end

  test "containment is not reported as a reference" do
    # Every node has a contains edge to its parent and its children. Counting those would
    # mean the number was dominated by the hierarchy the user is already looking at.
    impact = preview(@orders)

    assert_empty impact.references.select { |reference| reference.kind == "contains" }
  end

  test "preserving references leaves the prose alone" do
    mentioner = create_node(space: @space, title: "Runbook")
    block = create_block(
      node: mentioner,
      block_type: "markdown",
      data: { "markdown" => "See [@Order Service](#node-#{@orders.id})." }
    )

    run(@orders, mode: "soft", reference_policy: "preserve")

    assert_includes block.reload.data["markdown"], "#node-#{@orders.id}",
                    "A soft-deleted node can come back, so its links must survive"
  end

  test "removing references flattens the mention but keeps the words" do
    mentioner = create_node(space: @space, title: "Runbook")
    block = create_block(
      node: mentioner,
      block_type: "markdown",
      data: { "markdown" => "See [@Order Service](#node-#{@orders.id}) for details." }
    )

    run(@orders, mode: "hard", reference_policy: "remove")

    markdown = block.reload.data["markdown"]
    assert_equal "See @Order Service for details.", markdown
    assert_not_includes markdown, "#node-"
  end

  test "removing references only touches the nodes being deleted" do
    survivor = create_node(space: @space, title: "Search Service")
    mentioner = create_node(space: @space, title: "Runbook")
    block = create_block(
      node: mentioner,
      block_type: "markdown",
      data: { "markdown" => "[@Order Service](#node-#{@orders.id}) and [@Search](#node-#{survivor.id})" }
    )

    run(@orders, mode: "hard", reference_policy: "remove")

    markdown = block.reload.data["markdown"]
    assert_not_includes markdown, "#node-#{@orders.id}"
    assert_includes markdown, "#node-#{survivor.id}", "An unrelated mention must not be rewritten"
  end

  test "a node_reference block becomes the text it was rendering" do
    mentioner = create_node(space: @space, title: "Runbook")
    block = create_block(
      node: mentioner,
      block_type: "node_reference",
      data: { "nodeId" => @orders.id.to_s, "label" => "The order path" }
    )

    run(@orders, mode: "hard", reference_policy: "remove")

    block.reload
    assert_equal "text", block.block_type
    assert_equal "The order path", block.data["text"]
  end

  test "hard deletion defaults to removing references and soft to preserving them" do
    assert_predicate Documentation::DeletionPolicy.new(mode: "hard"), :remove_references?
    assert_predicate Documentation::DeletionPolicy.new(mode: "soft"), :preserve_references?
  end

  # --- Preview and execution agreeing ----------------------------------

  test "the digest changes when the graph changes" do
    before = preview(@orders).digest

    create_relationship(
      source: create_node(space: @space, title: "Late Arrival"),
      target: @orders,
      relationship_type: "calls"
    )

    assert_not_equal before, preview(@orders).digest
  end

  test "the digest changes when the policy changes" do
    assert_not_equal preview(@orders).digest, preview(@orders, orphan_policy: "delete").digest
  end

  test "a stale digest is refused and nothing is deleted" do
    deletion = Documentation::NodeDeletion.new(
      nodes: [ @orders ],
      policy: Documentation::DeletionPolicy.new(mode: "hard"),
      actor: @user
    )

    error = assert_raises(Documentation::NodeDeletion::ImpactChanged) do
      deletion.call(expected_digest: "a-digest-from-another-graph")
    end

    assert_predicate @orders.reload, :persisted?
    assert_predicate error.impact.digest, :present?, "The caller needs the fresh impact to redraw"
  end

  test "a matching digest goes through" do
    deletion = Documentation::NodeDeletion.new(
      nodes: [ @orders ],
      policy: Documentation::DeletionPolicy.new(mode: "hard"),
      actor: @user
    )

    deletion.call(expected_digest: deletion.impact.digest)

    assert_nil Node.with_deleted.find_by(id: @orders.id)
  end

  test "an unknown policy value falls back to the safe option rather than raising" do
    policy = Documentation::DeletionPolicy.new(mode: "obliterate", orphan_policy: "nuke")

    assert_predicate policy, :soft?
    assert_predicate policy, :keep_orphans?
  end

  private

  def preview(node, **policy)
    Documentation::NodeDeletion.new(
      nodes: [ node ],
      policy: Documentation::DeletionPolicy.new(**policy),
      actor: @user
    ).impact
  end

  def run(node, **policy)
    deletion = Documentation::NodeDeletion.new(
      nodes: [ node ],
      policy: Documentation::DeletionPolicy.new(**policy),
      actor: @user
    )
    impact = deletion.impact
    deletion.call

    impact
  end

  def contain(parent, child)
    create_relationship(source: parent, target: child, relationship_type: "contains")
  end

  def parent_ids_of(node)
    @space.node_relationships
          .where(target_node_id: node.id, relationship_type: "contains")
          .pluck(:source_node_id)
  end
end
