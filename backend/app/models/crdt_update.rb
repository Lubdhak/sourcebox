# frozen_string_literal: true

# One opaque CRDT update in a document's log.
#
# `created_at` without `updated_at`: a row here is written once and never touched again.
# Editing history is the sequence of these rows, so mutating one would be rewriting the
# past rather than recording it.
class CrdtUpdate < ApplicationRecord
  belongs_to :crdt_document
  belongs_to :actor, class_name: "User", optional: true

  validates :payload, presence: true
  validate :payload_must_be_bounded

  private

  def payload_must_be_bounded
    return if payload.blank?
    return if payload.bytesize <= CrdtDocument::MAX_UPDATE_BYTES

    errors.add(:payload, "exceeds #{CrdtDocument::MAX_UPDATE_BYTES / 1024}KB")
  end
end
