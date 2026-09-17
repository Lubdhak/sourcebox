# frozen_string_literal: true

module Documentation
  # Removes someone's access to a space, or withdraws an invitation that was never
  # claimed. One operation for both, because from the sharer's point of view they are the
  # same act -- the row is simply younger in one case.
  #
  # Their contributions stay. Nodes and blocks are attributed to the author
  # rather than owned by them, so revoking access removes the ability to read and write,
  # not the work: deleting a departing colleague's documentation is never what the person
  # clicking "remove" meant.
  class RevokeAccess < Operation
    def initialize(membership:, **options)
      super(**options)

      @membership = membership
    end

    def call
      space_id = @membership.documentation_space_id
      member_id = @membership.user_id
      role = @membership.role
      pending = @membership.pending?

      @membership.destroy!

      publish(
        Events::Names::SPACE_ACCESS_REVOKED,
        space_id: space_id,
        member_id: member_id,
        role: role,
        pending: pending
      )

      true
    end
  end
end
