# frozen_string_literal: true

require "test_helper"

# Where a new node lands: which node contains it, and which rung it sits on.
#
# Both are answered by the server rather than the client, and both used to have a hole in
# them -- a node created with no parent belonged nowhere and had no depth, which then
# propagated to everything created inside it.
class Documentation::CreateNodeTest < ActiveSupport::TestCase
  setup do
    @user = create_user
    @space = Documentation::CreateSpace.call(user: @user, name: "Platform")
  end

  test "the first node in a space becomes its root, on the first rung" do
    node = create_via_operation(title: "Application")

    assert_empty parent_ids_of(node)
    assert_equal 0, node.layer.index
  end

  test "a node created with no parent is adopted by the root of the space" do
    root = create_via_operation(title: "Application")
    child = create_via_operation(title: "Frontend")

    # Otherwise it would sit at the top of the space beside the root, reachable only from
    # there and saying nothing about how it relates to what is already documented.
    assert_equal [ root.id ], parent_ids_of(child)
    assert_equal 1, child.layer.index
  end

  test "the oldest top of the space wins when a space already has several" do
    first = create_node(space: @space, title: "Older", created_at: 2.days.ago)
    create_node(space: @space, title: "Newer", created_at: 1.day.ago)

    adopted = create_via_operation(title: "Something new")

    assert_equal [ first.id ], parent_ids_of(adopted)
  end

  test "a node created inside another lands one rung below it, growing the ladder" do
    root = create_via_operation(title: "Application")
    child = create_via_operation(title: "Backend", parent_node_id: root.id)

    grandchild = create_via_operation(title: "API", parent_node_id: child.id)

    assert_equal 2, grandchild.layer.index
    assert_equal [ 0, 1, 2 ], @space.layers.reload.map(&:index).sort,
                 "The depth the user needed came into existence when they needed it"
  end

  test "an explicit depth wins over the one containment would imply" do
    root = create_via_operation(title: "Application")
    alongside = @space.layers.find_by(index: 0)

    node = create_via_operation(title: "Sidecar", parent_node_id: root.id, layer_id: alongside.id)

    # Containment and depth are related by default, not welded together: putting a child
    # on its parent's rung is a legitimate thing to ask for.
    assert_equal alongside.id, node.layer_id
  end

  # --- Repairing what was created before the rule existed ---------------

  test "the depth repair reads containment and leaves deliberate choices alone" do
    root = create_node(space: @space, title: "Application")
    middle = create_node(space: @space, title: "Backend")
    leaf = create_node(space: @space, title: "API")
    pinned = create_node(space: @space, title: "Sidecar", layer: @space.layers.find_by(index: 0))

    [ [ root, middle ], [ middle, leaf ], [ middle, pinned ] ].each do |parent, child|
      create_relationship(source: parent, target: child, relationship_type: "contains")
    end

    result = Documentation::AssignMissingDepths.call(space: @space)

    assert_equal 3, result.assigned
    assert_equal 0, root.reload.layer.index
    assert_equal 1, middle.reload.layer.index
    assert_equal 2, leaf.reload.layer.index
    # Somebody put this one on its parent's rung on purpose; a repair must not overrule it.
    assert_equal 0, pinned.reload.layer.index
  end

  test "the depth repair takes the shortest way down to a node reachable by two paths" do
    root = create_node(space: @space, title: "Application")
    middle = create_node(space: @space, title: "Backend")
    shared = create_node(space: @space, title: "users table")

    create_relationship(source: root, target: middle, relationship_type: "contains")
    create_relationship(source: root, target: shared, relationship_type: "contains")
    create_relationship(source: middle, target: shared, relationship_type: "contains")

    Documentation::AssignMissingDepths.call(space: @space)

    # Reachable at depth 1 and at depth 2. The shorter path is the one a reader travels.
    assert_equal 1, shared.reload.layer.index
  end

  private

  def create_via_operation(**attributes)
    Documentation::CreateNode.call(space: @space, actor: @user, **attributes)
  end

  def parent_ids_of(node)
    @space.node_relationships
          .where(target_node_id: node.id, relationship_type: "contains")
          .pluck(:source_node_id)
  end
end
