# frozen_string_literal: true

require "test_helper"

class CrdtDocumentTest < ActiveSupport::TestCase
  setup do
    @document = CrdtDocument.for_node(create_node(space: create_space))
  end

  test "pages a log without instantiating update models" do
    records = 5.times.map { |i| @document.append("update-#{i}") }
    first = @document.sync_payload(limit: 2)
    assert_equal records.first(2).map { |row| Base64.strict_encode64(row.payload) }, first[:updates]
    assert_not first[:syncComplete]

    second = @document.sync_payload(after_seq: first[:seq], limit: 2)
    assert_equal records[2..3].map { |row| Base64.strict_encode64(row.payload) }, second[:updates]
    assert_nil second[:snapshot]
    assert_not second[:syncComplete]

    last = @document.sync_payload(after_seq: second[:seq], limit: 2)
    assert_equal [ Base64.strict_encode64(records.last.payload) ], last[:updates]
    assert last[:syncComplete]
    assert_equal records.last.id, last[:seq]
  end

  test "a stale channel receives the latest snapshot and preserves later updates" do
    first = @document.append("first")
    stale = CrdtDocument.find(@document.id)
    @document.append("second")
    assert @document.compact!("merged first", first.id)

    payload = stale.sync_payload
    assert_equal Base64.strict_encode64("merged first"), payload[:snapshot]
    assert_equal [ Base64.strict_encode64("second") ], payload[:updates]
    assert_equal 1, @document.updates.count
  end

  test "an intervening compaction restarts a paged sync from the new snapshot" do
    first = @document.append("first")
    second = @document.append("second")
    @document.append("third")
    assert @document.compact!("merged", second.id)

    payload = @document.sync_payload(after_seq: first.id, limit: 1)
    assert_equal Base64.strict_encode64("merged"), payload[:snapshot]
    assert_equal [ Base64.strict_encode64("third") ], payload[:updates]
    assert payload[:syncComplete]
  end

  test "an older checkpoint cannot overwrite a newer one on a stale instance" do
    first = @document.append("first")
    second = @document.append("second")
    stale = CrdtDocument.find(@document.id)
    assert @document.compact!("newer", second.id)
    assert_not stale.compact!("older", first.id)
    assert_equal "newer", @document.reload.snapshot
    assert_equal second.id, @document.snapshot_seq
  end

  test "a future checkpoint never deletes updates" do
    record = @document.append("first")
    assert_not @document.compact!("invalid", record.id + 1)
    assert_equal 1, @document.updates.count
  end

  test "compaction is requested only after the complete log is delivered" do
    CrdtDocument::COMPACTION_THRESHOLD.times { @document.append("update") }
    first = @document.sync_payload(limit: CrdtDocument::SYNC_BATCH_SIZE)
    assert_not first[:compactionNeeded]
    payload = @document.sync_payload
    assert payload[:compactionNeeded]
    assert_equal CrdtDocument::COMPACTION_THRESHOLD, payload[:compactionThreshold]
  end
end
