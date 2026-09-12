# frozen_string_literal: true

# Append-only record of state changes.
#
# Deliberately not a `belongs_to`: an audit trail has to survive the deletion of the
# thing it describes, so the ids are plain columns with no foreign key and no
# cascade. `changed_keys` records *which* fields moved, never their values, so the
# trail can be retained long-term without becoming a copy of user data.
class AuditLog < ApplicationRecord
  validates :event_name, presence: true
  validates :occurred_at, presence: true

  scope :recent, -> { order(occurred_at: :desc) }

  def readonly?
    persisted?
  end
end
