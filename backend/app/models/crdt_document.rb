# frozen_string_literal: true

# The collaborative editing state for one node's content.
#
# Deliberately ignorant of what it stores. The bytes are Yjs updates; this class knows
# only that they are opaque, ordered, and that a client can merge a run of them into one.
# That ignorance is what keeps the merge algorithm in exactly one place -- the browsers --
# instead of in two implementations that must agree forever.
#
# The relationship to `content_blocks` is worth being explicit about, because two things
# holding the same text is normally a bug. This is the live editing surface: it exists
# while people are typing and it is where concurrent edits converge. `content_blocks` is
# the durable record: it is what search indexes, what the inspector renders for a reader,
# and what survives if this table is dropped. The editing client commits the converged
# text back to the block a moment after typing stops, so the two agree at rest and only
# diverge for as long as someone is mid-sentence.
class CrdtDocument < ApplicationRecord
  belongs_to :node
  has_many :updates, -> { order(:id) }, class_name: "CrdtUpdate", dependent: :delete_all, inverse_of: :crdt_document

  # A single update is a keystroke or a paste. A megabyte of it is not editing, it is
  # either a bug or someone using the relay as storage.
  MAX_UPDATE_BYTES = 256.kilobytes

  # How long a replay may get before a client is asked to compact. Roughly a few minutes
  # of one person typing; low enough that a joiner's first sync stays small, high enough
  # that compaction is not constant.
  COMPACTION_THRESHOLD = 300

  def self.for_node(node)
    find_or_create_by!(node_id: node.id)
  end

  # Everything a joining client needs to reconstruct the document: the merged snapshot,
  # then the updates recorded since it was taken.
  def sync_payload
    pending = updates.where("id > ?", snapshot_seq).to_a

    {
      snapshot: encode(snapshot),
      updates: pending.map { |update| encode(update.payload) },
      seq: pending.last&.id || snapshot_seq,
      compactionNeeded: pending.size >= COMPACTION_THRESHOLD,
    }
  end

  def append(payload, actor_id: nil)
    updates.create!(payload: payload, actor_id: actor_id, created_at: Time.current)
  end

  # Replaces the log up to `through_seq` with a merged snapshot supplied by a client.
  #
  # Only a client can do this, because only a client can merge. The server's safety
  # condition is that it never discards an update the snapshot does not cover: the
  # sequence is checked against what exists, and anything newer than the snapshot is
  # kept and replayed on top of it.
  def compact!(merged_state, through_seq)
    through_seq = through_seq.to_i
    return false if merged_state.blank? || through_seq <= snapshot_seq

    # A sequence from the future would truncate updates the snapshot cannot contain.
    return false if through_seq > (updates.maximum(:id) || 0)

    transaction do
      update!(snapshot: merged_state, snapshot_seq: through_seq)
      updates.where(id: ..through_seq).delete_all
    end

    true
  end

  private

  # Action Cable frames are JSON, so binary crosses it base64-encoded. Strict encoding
  # because the newlines the lenient variant inserts are not valid in a JSON string and
  # would have to be stripped by every client.
  def encode(bytes)
    return nil if bytes.blank?

    Base64.strict_encode64(bytes.to_s)
  end
end
