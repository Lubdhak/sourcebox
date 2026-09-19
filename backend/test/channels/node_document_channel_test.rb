# frozen_string_literal: true

require "test_helper"

class NodeDocumentChannelTest < ActionCable::Channel::TestCase
  include DocumentationFactories

  setup do
    @user = create_user
    @node = create_node(space: create_space(user: @user))
    @document = CrdtDocument.for_node(@node)
    stub_connection current_user: @user
  end

  test "paged sync must complete before compaction is accepted" do
    (CrdtDocument::SYNC_BATCH_SIZE + 1).times { @document.append("update") }
    subscribe node_id: @node.id, session_id: "test", sync_pages: true
    assert subscription.confirmed?
    first = transmissions.last
    assert_equal CrdtDocument::SYNC_BATCH_SIZE, first["updates"].size
    assert_not first["syncComplete"]

    perform :compact, state: Base64.strict_encode64("merged"), throughSeq: first["seq"]
    assert_equal "rejected", transmissions.last["type"]
    assert_equal CrdtDocument::SYNC_BATCH_SIZE + 1, @document.updates.count

    perform :sync, afterSeq: first["seq"]
    last = transmissions.last
    assert last["syncComplete"]
    assert_equal 1, last["updates"].size
    perform :compact, state: Base64.strict_encode64("merged"), throughSeq: last["seq"]
    assert_empty @document.updates.reload
    assert_equal "merged", @document.reload.snapshot
  end

  test "legacy clients can still receive a complete sync" do
    @document.append("update")
    subscribe node_id: @node.id, session_id: "legacy"
    assert transmissions.last["syncComplete"]
    assert_equal [ Base64.strict_encode64("update") ], transmissions.last["updates"]
  end

  test "a new update cannot authorize truncation past the delivered checkpoint" do
    first = @document.append("first")
    subscribe node_id: @node.id, session_id: "test", sync_pages: true
    second = @document.append("second")
    perform :compact, state: Base64.strict_encode64("invalid"), throughSeq: second.id
    assert_equal "rejected", transmissions.last["type"]
    assert_equal 2, @document.updates.count
    perform :compact, state: Base64.strict_encode64("first snapshot"), throughSeq: first.id
    assert_equal [ second.id ], @document.updates.pluck(:id)
  end

  test "an invalid continuation cursor is rejected explicitly" do
    subscribe node_id: @node.id, session_id: "test", sync_pages: true
    perform :sync, afterSeq: 999
    assert_equal "rejected", transmissions.last["type"]
  end
end
