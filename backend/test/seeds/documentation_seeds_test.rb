# frozen_string_literal: true

require "test_helper"

class DocumentationSeedsTest < ActiveSupport::TestCase
  test "reseeding converges fixture data without replacing records or unrelated content" do
    owner = create_user(email: "lubi@gmail.com")
    seed_documentation
    space = owner.documentation_spaces.find_by!(slug: "system-design-knowledge-graph")
    node = space.nodes.find_by!(title: "System Design")
    block = node.content_blocks.first
    original_data = block.data
    original_summary = node.summary
    counts = [ space.nodes.count, space.node_relationships.count ]
    extra = create_node(space: space, title: "User notes")
    extra_block = create_block(node: extra, data: { "text" => "Keep this." })
    node.update!(summary: "Changed")
    block.update!(data: { "markdown" => "Changed" })
    surplus = create_block(node: node, position: 100)

    seed_documentation

    assert_equal counts.first + 1, space.nodes.count
    assert_equal counts.last, space.node_relationships.count
    assert_equal original_summary, node.reload.summary
    assert_equal original_data, block.reload.data
    assert_not ContentBlock.exists?(surplus.id)
    assert_equal "Keep this.", extra_block.reload.data["text"]
    assert_operator seed_documentation, :<=, counts.first * 2 + 10,
                    "An unchanged seed should not look up every node, block and edge individually"
  end

  private

  def seed_documentation
    selects = 0
    counter = lambda do |event|
      selects += 1 if event.payload[:sql].start_with?("SELECT") && event.payload[:name] != "SCHEMA"
    end
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") do
      capture_io { load Rails.root.join("db/seeds/documentation.rb"), true }
    end
    selects
  end
end
