# frozen_string_literal: true

# A container for one documentation graph: its nodes, relationships, layers and content.
#
# This is the authorization boundary. Nothing beneath it carries a `user_id` of its own,
# so every read and write of a node, edge, layer or block has to arrive here first --
# see ApplicationGraphql::Authorization#authorize_space!.
#
# Access is the owner plus a set of memberships, and `role_for` is the single function
# that answers what any given person may do here. Everything else in the codebase asks
# that question through `permits?`; no other file compares a user id to `user_id`.
class DocumentationSpace < ApplicationRecord
  belongs_to :user

  has_many :nodes, dependent: :destroy
  has_many :node_relationships, dependent: :destroy
  has_many :space_memberships, dependent: :destroy
  has_many :members, through: :space_memberships, source: :user

  # Bounds on the loose part of the document, for the same reason Dashboard has them:
  # this is client-supplied JSON reaching storage, and without a cap it is an unbounded
  # write primitive.
  MAX_SERIALIZED_SETTINGS_BYTES = 16.kilobytes

  validates :name, presence: true, length: { maximum: 120 }
  validates :slug, presence: true,
                   length: { maximum: 120 },
                   format: {
                     with: /\A[a-z0-9]+(?:-[a-z0-9]+)*\z/,
                     message: "may only contain lowercase letters, numbers and hyphens",
                   },
                   uniqueness: { scope: :user_id, case_sensitive: false }
  validates :description, length: { maximum: 2_000 }, allow_blank: true
  validate :settings_must_be_a_bounded_object

  before_validation :derive_slug_from_name, if: -> { slug.blank? && name.present? }

  scope :alphabetical, -> { order(:name) }

  # Everything `user` may open: their own spaces and the ones shared with them.
  #
  # A union of two indexed lookups rather than a LEFT JOIN with an OR, because the OR
  # form cannot use either index and degrades as soon as a user is a member of more
  # spaces than they own -- which is the normal state of affairs in a team.
  scope :accessible_by, lambda { |user|
    return none if user.blank?

    shared = SpaceMembership.claimed.where(user_id: user.id).select(:documentation_space_id)
    where(user_id: user.id).or(where(id: shared))
  }

  # Spaces are addressed by their UUID in URLs. Callers hand us whatever the client sent,
  # so this accepts either form and never raises on a malformed value -- a bad id must
  # produce the same "not found" as an id belonging to somebody else.
  def self.find_by_public_id(value)
    return nil if value.blank?

    find_by(public_id: value)
  rescue ActiveRecord::StatementInvalid
    # PostgreSQL rejects a malformed uuid literal rather than returning no rows.
    nil
  end

  def to_param
    public_id
  end

  # The least privileged role that may do each kind of thing.
  MINIMUM_ROLE = {
    read: "viewer",
    write: "editor",
    admin: "admin",
  }.freeze

  # What this person may do here: "owner", one of SpaceMembership::ROLES, or nil for
  # someone with no access at all. Nil is deliberately not "viewer" -- a stranger is not
  # a reader, and conflating the two is how read-everything bugs get written.
  def role_for(user)
    return nil if user.blank?
    return "owner" if user_id == user.id

    space_memberships.claimed.find_by(user_id: user.id)&.role
  end

  # The authorization question, asked once. `minimum` is the least privileged role that
  # may do the thing: :read for any access at all, :write to change the graph, :admin to
  # manage who else has access.
  def permits?(user, minimum)
    role = role_for(user)
    return false if role.nil?

    SpaceMembership.allows?(role, MINIMUM_ROLE.fetch(minimum))
  end

  private

  def derive_slug_from_name
    base = name.to_s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
    base = "space" if base.blank?

    # Uniqueness is per owner, so a second "Payment Platform" becomes payment-platform-2
    # rather than failing validation on a name the user is entitled to reuse.
    candidate = base
    suffix = 2
    while user_id.present? &&
          DocumentationSpace.where(user_id: user_id, slug: candidate).where.not(id: id).exists?
      candidate = "#{base}-#{suffix}"
      suffix += 1
    end

    self.slug = candidate
  end

  def settings_must_be_a_bounded_object
    unless settings.is_a?(Hash)
      errors.add(:settings, "must be a JSON object")
      return
    end

    if settings.to_json.bytesize > MAX_SERIALIZED_SETTINGS_BYTES
      errors.add(:settings, "exceeds #{MAX_SERIALIZED_SETTINGS_BYTES / 1024}KB")
    end
  end
end
