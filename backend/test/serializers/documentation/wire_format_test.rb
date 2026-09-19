# frozen_string_literal: true

require "test_helper"

class Documentation::WireFormatTest < ActiveSupport::TestCase
  setup do
    @space = create_space
    @root = create_node(space: @space, title: "Root")
    @folder = create_node(space: @space, title: "Folder")
    @child = create_node(space: @space, title: "Child")
    @neighbor = create_node(space: @space, title: "Neighbor")
    create_relationship(source: @root, target: @folder, relationship_type: "contains")
    create_relationship(source: @folder, target: @child, relationship_type: "contains")
    create_relationship(source: @child, target: @neighbor)
    create_relationship(source: @root, target: @neighbor, relationship_type: "contains")
  end

  test "initial graph matches GraphQL for nodes focus trail and neighbors" do
    [ nil, @folder.id.to_s ].each do |focus|
      snapshot = Documentation::GraphSnapshot.call(space: @space, focus_node_id: focus)
      initial = Documentation::WireFormat.graph(snapshot).deep_stringify_keys
      response = execute_graphql(<<~GRAPHQL, variables: { id: @space.public_id, focus: focus }, user: @space.user)
        fragment CanvasNode on Node {
          id title summary metadata childCount relationshipCount parentNodeId
          position { x y z }
          size { width height depth }
          parents { id title parentNodeId }
        }
        query($id: ID!, $focus: ID) {
          documentationSpace(id: $id) {
            graph(focusNodeId: $focus) {
              nodes { ...CanvasNode }
              neighbors { ...CanvasNode }
              focusNode { ...CanvasNode }
              trail { ...CanvasNode }
              relationships { id relationshipType sourceNodeId targetNodeId metadata }
              nodeCount relationshipCount truncated
            }
          }
        }
      GRAPHQL

      assert_no_graphql_errors(response)
      assert_equal response.dig("data", "documentationSpace", "graph"), initial
    end
  end

  test "isolated nodes have explicit zero counts without content bodies" do
    isolated = create_node(space: @space)
    create_block(node: isolated)
    snapshot = Documentation::GraphSnapshot.call(space: @space)
    record = Documentation::WireFormat.graph(snapshot)[:nodes].find { |node| node[:id] == isolated.id.to_s }

    assert_equal 0, record[:relationshipCount]
    assert_equal 0, record[:childCount]
    assert_empty record[:parents]
    assert_not record.key?(:contentBlocks)
  end

  test "serializing more nodes does not add per-node queries" do
    small = serialization_query_count
    10.times do
      node = create_node(space: @space)
      create_relationship(source: @folder, target: node, relationship_type: "contains")
      create_relationship(source: node, target: @neighbor)
    end

    assert_equal small, serialization_query_count
  end

  private

  def serialization_query_count
    snapshot = Documentation::GraphSnapshot.call(space: @space, focus_node_id: @folder.id)
    queries = 0
    counter = lambda do |event|
      queries += 1 unless event.payload[:name] == "SCHEMA" || event.payload[:cached]
    end

    ActiveRecord::Base.uncached do
      ActiveSupport::Notifications.subscribed(counter, "sql.active_record") do
        Documentation::WireFormat.graph(snapshot)
      end
    end

    queries
  end
end
