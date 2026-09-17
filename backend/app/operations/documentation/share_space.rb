# frozen_string_literal: true

module Documentation
  # Gives someone access to a space, by email address.
  #
  # By address rather than by user id, and that is the whole design: the person granting
  # access knows their colleague's email, not their id, and frequently the colleague has
  # no account yet. So the address is the identifier, and whether a `users` row exists
  # for it only decides whether the membership is claimed now or waiting to be
  # (SpaceMembership.claim_all_for, run at sign-in).
  #
  # Re-sharing with someone who already has access sets their role instead of failing.
  # "Add Ada as an editor" means the same thing whether or not Ada is already a viewer,
  # and an error there would send the sharer hunting for a separate control to do what
  # they just asked for.
  class ShareSpace < Operation
    def initialize(space:, email:, role:, **options)
      super(**options)

      @space = space
      @email = email.to_s.downcase.strip
      @role = role.to_s
    end

    def call
      invitee = User.find_by("lower(email) = ?", @email)

      reject!(:email, "already owns this space.") if invitee && invitee.id == @space.user_id

      membership = ActiveRecord::Base.transaction do
        existing = find_existing(invitee)

        if existing
          existing.update!(role: @role, invited_by: actor)
          existing
        elsif invitee
          @space.space_memberships.create!(
            user: invitee, role: @role, invited_by: actor, accepted_at: Time.current
          )
        else
          @space.space_memberships.create!(invited_email: @email, role: @role, invited_by: actor)
        end
      end

      publish(
        Events::Names::SPACE_SHARED,
        space_id: @space.id,
        membership_id: membership.id,
        role: membership.role,
        # The address is not logged. Who was granted access is recorded by id where one
        # exists; an event stream is a poor place to accumulate contact details.
        pending: membership.pending?
      )

      membership
    end

    private

    def find_existing(invitee)
      by_email = @space.space_memberships.pending.find_by("lower(invited_email) = ?", @email)
      return by_email if by_email
      return nil if invitee.nil?

      @space.space_memberships.claimed.find_by(user_id: invitee.id)
    end

    # Surfaced as an ordinary validation failure, so the client renders it beside the
    # field the user typed into rather than as a generic error.
    def reject!(attribute, message)
      record = SpaceMembership.new(documentation_space: @space, invited_email: @email, role: @role)
      record.errors.add(attribute, message)

      raise ActiveRecord::RecordInvalid, record
    end
  end
end
