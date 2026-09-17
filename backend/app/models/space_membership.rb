# frozen_string_literal: true

# One person's access to one space, or an invitation waiting to become that.
#
# Access used to be a single column on the space, and the whole authorization story was
# "does this row's user_id equal yours". That is the rule this table replaces, so it is
# now the only place a role is recorded and the only thing the boundary checks -- with
# one exception: the space's owner. Ownership stays on `documentation_spaces.user_id`
# rather than becoming a membership row, because it is not revocable, and modelling it as
# a revocable grant would make "remove the last admin" a reachable state.
#
# Roles are ordered by what they permit, and the order is the authorization rule itself
# (see RANK). Anything that needs "at least an editor" asks for the rank rather than
# listing the roles that qualify, so adding a role later cannot silently widen a check
# that enumerated its way around it.
class SpaceMembership < ApplicationRecord
  belongs_to :documentation_space
  belongs_to :user, optional: true
  belongs_to :invited_by, class_name: "User", optional: true

  ROLES = %w[viewer editor admin].freeze

  # Owner is not a membership, but it is a role for the purpose of comparisons, and it
  # outranks everything. Keeping it in the same scale means one function answers "may
  # this person do that" for owner and member alike.
  RANK = { "viewer" => 0, "editor" => 1, "admin" => 2, "owner" => 3 }.freeze

  validates :role, presence: true, inclusion: { in: ROLES }
  validates :invited_email,
            format: { with: URI::MailTo::EMAIL_REGEXP, message: "is not a valid email address" },
            length: { maximum: 255 },
            allow_nil: true
  validate :identifies_exactly_one_person

  before_validation :normalize_invited_email

  scope :claimed, -> { where.not(user_id: nil) }
  scope :pending, -> { where(user_id: nil) }

  def self.rank(role)
    RANK.fetch(role.to_s, -1)
  end

  # Whether `role` permits everything `minimum` permits.
  def self.allows?(role, minimum)
    rank(role) >= rank(minimum)
  end

  def self.pending_for_email(email)
    return none if email.blank?

    where(user_id: nil).where("lower(invited_email) = ?", email.to_s.downcase.strip)
  end

  # Turns every outstanding invitation for this user's address into real access.
  #
  # Run at sign-in rather than at sign-up, so that an invitation sent to someone who
  # already has an account works the same way as one sent to a stranger -- the two cases
  # differ only in how long the row waits here.
  def self.claim_all_for(user)
    return 0 if user.blank? || user.email.blank?

    claimed = 0

    pending_for_email(user.email).find_each do |membership|
      # A second invitation to a space the user already belongs to is dropped rather than
      # applied: their existing role is the one that was deliberately set, and letting a
      # stale invitation overwrite it would be a silent downgrade -- or a privilege
      # escalation, which is worse.
      if exists?(documentation_space_id: membership.documentation_space_id, user_id: user.id)
        membership.destroy
        next
      end

      membership.update!(user: user, invited_email: nil, accepted_at: Time.current)
      claimed += 1
    rescue ActiveRecord::RecordNotUnique
      # Two sessions claiming at once. The other one won, which is the same outcome.
      membership.destroy
    end

    claimed
  end

  def pending?
    user_id.nil?
  end

  def display_name
    user&.display_name || invited_email.to_s.split("@").first
  end

  def email
    user&.email || invited_email
  end

  private

  def normalize_invited_email
    self.invited_email = invited_email.to_s.downcase.strip.presence if invited_email.present?
  end

  def identifies_exactly_one_person
    return if user_id.present? ^ invited_email.present?

    errors.add(:base, "a membership names either a user or an invited email address")
  end
end
