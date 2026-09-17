# frozen_string_literal: true

require "test_helper"

class ContentBlockTest < ActiveSupport::TestCase
  setup do
    @node = create_node(space: create_space)
  end

  test "rejects an unsupported block type" do
    block = build_block(block_type: "hologram", data: {})

    assert_not block.valid?
    assert_includes block.errors[:block_type], "is not a supported block type"
  end

  test "validates the payload shape per type" do
    # The point of one table for every block type: the shape is enforced in the model,
    # per type, rather than by twelve tables of columns.
    cases = {
      "text"     => [ { "text" => "hello" }, {} ],
      "markdown" => [ { "markdown" => "# hi" }, { "text" => "wrong key" } ],
      "code"     => [ { "code" => "puts 1" }, { "language" => "ruby" } ],
      "url"      => [ { "url" => "https://example.com" }, { "label" => "no url" } ],
      "table"    => [ { "columns" => [ "a" ], "rows" => [ [ 1 ] ] }, { "columns" => [ "a" ] } ],
      "json"     => [ { "value" => [ 1, 2 ] }, {} ],
      "node_reference" => [ { "nodeId" => "12" }, { "label" => "no id" } ],
    }

    cases.each do |block_type, (valid_data, invalid_data)|
      assert_predicate build_block(block_type: block_type, data: valid_data), :valid?,
                       "#{block_type} should accept #{valid_data.inspect}"
      assert_not build_block(block_type: block_type, data: invalid_data).valid?,
                 "#{block_type} should reject #{invalid_data.inspect}"
    end
  end

  test "rejects a required key of the wrong type" do
    block = build_block(block_type: "table", data: { "columns" => "id", "rows" => [] })

    assert_not block.valid?
    assert_includes block.errors[:data], "columns must be array"
  end

  test "allows unknown keys so renderer hints need no migration" do
    block = build_block(block_type: "text", data: { "text" => "hi", "highlight" => "warning" })

    assert_predicate block, :valid?
  end

  test "accepts an optional title on any type" do
    assert_predicate build_block(block_type: "text", data: { "text" => "hi", "title" => "Overview" }), :valid?
    assert_not build_block(block_type: "text", data: { "text" => "hi", "title" => 42 }).valid?
  end

  test "bounds the payload size" do
    block = build_block(block_type: "text", data: { "text" => "x" * (ContentBlock::MAX_SERIALIZED_DATA_BYTES + 1) })

    assert_not block.valid?
    assert_match(/exceeds/, block.errors[:data].first)
  end

  test "bounds table dimensions, which shape validation alone does not" do
    too_many_columns = build_block(
      block_type: "table",
      data: { "columns" => Array.new(ContentBlock::MAX_TABLE_COLUMNS + 1) { |i| "c#{i}" }, "rows" => [] }
    )

    assert_not too_many_columns.valid?
    assert_match(/columns/, too_many_columns.errors[:data].first)

    malformed_rows = build_block(
      block_type: "table",
      data: { "columns" => [ "a" ], "rows" => [ "not an array" ] }
    )

    assert_not malformed_rows.valid?
    assert_includes malformed_rows.errors[:data], "rows must be arrays"
  end

  test "positions are unique within a node" do
    create_block(node: @node, position: 0)
    duplicate = build_block(block_type: "text", data: { "text" => "second" }, position: 0)

    assert_raises(ActiveRecord::RecordNotUnique) { duplicate.save!(validate: false) }
  end

  test "preview renders each type as plain text" do
    assert_equal "Some prose.", create_block(node: @node, block_type: "text").preview
    assert_equal "puts 1", create_block(node: @node, block_type: "code").preview
    assert_equal "a", create_block(node: @node, block_type: "table").preview
  end

  test "full-text search reaches string leaves at any depth" do
    create_block(
      node: @node,
      block_type: "json",
      data: { "value" => { "deeply" => { "nested" => "webhook retries" } } }
    )

    assert_equal 1, ContentBlock.where(node: @node).matching("webhook").count
  end

  private

  def build_block(block_type:, data:, position: 99)
    ContentBlock.new(node: @node, block_type: block_type, data: data, position: position)
  end
end
