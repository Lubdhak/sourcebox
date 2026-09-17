# frozen_string_literal: true

require "test_helper"

class Documentation::MoveNodesTest < ActiveSupport::TestCase
  setup do
    @user = create_user
    @space = create_space(user: @user)
    @first = create_node(space: @space, x: 0, y: 0)
    @second = create_node(space: @space, x: 0, y: 0)
  end

  test "moves a batch in one statement" do
    Documentation::MoveNodes.call(
      space: @space,
      actor: @user,
      positions: [
        { id: @first.id, x: 100.5, y: -50.25, z: 3.0 },
        { id: @second.id, x: 10.0, y: 20.0 },
      ]
    )

    assert_equal [ 100.5, -50.25, 3.0 ], [ @first.reload.x, @first.y, @first.z ]
    assert_equal [ 10.0, 20.0, 0.0 ], [ @second.reload.x, @second.y, @second.z ]
  end

  test "silently ignores ids outside the space" do
    # The space is the authorization boundary, and this is where it is enforced for a
    # mutation whose arguments are a list of ids. A node from elsewhere is not found in
    # `space.nodes`, so it is dropped rather than written to.
    foreign = create_node(space: create_space, x: 0, y: 0)

    moved = Documentation::MoveNodes.call(
      space: @space,
      actor: @user,
      positions: [ { id: @first.id, x: 5.0, y: 5.0 }, { id: foreign.id, x: 999.0, y: 999.0 } ]
    )

    assert_equal [ @first.id ], moved.map(&:id)
    assert_equal 0.0, foreign.reload.x
  end

  test "rejects coordinates beyond the limit" do
    # update_all skips validations, so the bound Node declares has to be re-applied here
    # or this becomes the one write path that can escape it.
    error = assert_raises(ApplicationGraphql::ValidationError) do
      Documentation::MoveNodes.call(
        space: @space,
        actor: @user,
        positions: [ { id: @first.id, x: Node::COORDINATE_LIMIT * 2, y: 0.0 } ]
      )
    end

    assert_match(/between/, error.message)
    assert_equal 0.0, @first.reload.x
  end

  test "rejects a non-numeric coordinate" do
    assert_raises(ApplicationGraphql::ValidationError) do
      Documentation::MoveNodes.call(
        space: @space,
        actor: @user,
        positions: [ { id: @first.id, x: "over there", y: 0.0 } ]
      )
    end
  end

  test "rejects a batch larger than the cap" do
    positions = Array.new(Documentation::MoveNodes::MAX_NODES_PER_MOVE + 1) do
      { id: @first.id, x: 1.0, y: 1.0 }
    end

    assert_raises(ApplicationGraphql::ValidationError) do
      Documentation::MoveNodes.call(space: @space, actor: @user, positions: positions)
    end
  end

  test "an empty batch is a no-op" do
    assert_equal [], Documentation::MoveNodes.call(space: @space, actor: @user, positions: [])
  end
end
