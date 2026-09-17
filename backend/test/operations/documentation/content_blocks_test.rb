# frozen_string_literal: true

require "test_helper"

# Covers the three operations that share one invariant: a node's block positions are
# 0-based and contiguous. Everything about inserting, reordering and deleting is in
# service of that, because the editor inserts by index.
class Documentation::ContentBlocksTest < ActiveSupport::TestCase
  setup do
    @user = create_user
    @space = create_space(user: @user)
    @node = create_node(space: @space)
  end

  test "upsert appends when no block id is given" do
    first = upsert(block_type: "text", data: { "text" => "one" })
    second = upsert(block_type: "text", data: { "text" => "two" })

    assert_equal [ 0, 1 ], [ first.position, second.position ]
  end

  test "upsert updates in place when a block id is given" do
    block = upsert(block_type: "text", data: { "text" => "draft" })

    updated = upsert(block_id: block.id, block_type: "text", data: { "text" => "final" })

    assert_equal block.id, updated.id
    assert_equal "final", updated.data["text"]
    assert_equal 1, @node.content_blocks.count
  end

  test "upsert with a position inserts and renumbers the blocks below it" do
    first = upsert(block_type: "text", data: { "text" => "one" })
    second = upsert(block_type: "text", data: { "text" => "two" })

    inserted = upsert(block_type: "markdown", data: { "markdown" => "# top" }, position: 0)

    assert_equal [ inserted.id, first.id, second.id ], ordered_ids
    assert_equal [ 0, 1, 2 ], ordered_positions
  end

  test "a block id belonging to another node is not found rather than reparented" do
    other_block = create_block(node: create_node(space: @space))

    assert_raises(ApplicationGraphql::NotFoundError) do
      upsert(block_id: other_block.id, block_type: "text", data: { "text" => "stolen" })
    end
  end

  test "an invalid payload is rejected with field errors" do
    error = assert_raises(ActiveRecord::RecordInvalid) do
      upsert(block_type: "table", data: { "columns" => [ "a" ] })
    end

    assert_includes error.record.errors[:data], "must include rows"
  end

  test "deleting closes the gap" do
    blocks = 4.times.map { |i| upsert(block_type: "text", data: { "text" => i.to_s }) }

    Documentation::DeleteContentBlock.call(block: blocks[1], actor: @user)

    assert_equal [ blocks[0].id, blocks[2].id, blocks[3].id ], ordered_ids
    assert_equal [ 0, 1, 2 ], ordered_positions
  end

  test "reordering survives a full reversal" do
    # The case that a naive renumbering gets wrong: writing final positions directly
    # collides with the unique index the moment two blocks swap, because PostgreSQL
    # checks uniqueness per row rather than at statement end.
    blocks = 3.times.map { |i| upsert(block_type: "text", data: { "text" => i.to_s }) }

    Documentation::ReorderContentBlocks.call(
      node: @node,
      ordered_block_ids: blocks.reverse.map(&:id),
      actor: @user
    )

    assert_equal blocks.reverse.map(&:id), ordered_ids
    assert_equal [ 0, 1, 2 ], ordered_positions
  end

  test "reordering with a partial list keeps the omitted blocks at the end" do
    blocks = 3.times.map { |i| upsert(block_type: "text", data: { "text" => i.to_s }) }

    Documentation::ReorderContentBlocks.call(
      node: @node,
      ordered_block_ids: [ blocks[2].id ],
      actor: @user
    )

    assert_equal [ blocks[2].id, blocks[0].id, blocks[1].id ], ordered_ids
  end

  private

  def upsert(**attributes)
    Documentation::UpsertContentBlock.call(node: @node, actor: @user, **attributes)
  end

  def ordered_ids
    @node.content_blocks.reload.ordered.pluck(:id)
  end

  def ordered_positions
    @node.content_blocks.reload.ordered.pluck(:position)
  end
end
