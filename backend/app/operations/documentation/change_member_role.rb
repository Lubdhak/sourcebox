# frozen_string_literal: true

module Documentation
  # Changes what one member may do in a space.
  #
  # Nothing here can touch the owner: ownership is not a membership row, so there is no
  # role to change and no way for this operation to reach it. That is what guarantees a
  # space always has someone who can restore access after a mistake made with it.
  class ChangeMemberRole < Operation
    def initialize(membership:, role:, **options)
      super(**options)

      @membership = membership
      @role = role.to_s
    end

    def call
      previous = @membership.role

      @membership.update!(role: @role)

      # A no-op update is not an event. Replaying the stream should show the decisions
      # that were made, not every time a select was closed on the value it already had.
      if previous != @membership.role
        publish(
          Events::Names::SPACE_ROLE_CHANGED,
          space_id: @membership.documentation_space_id,
          membership_id: @membership.id,
          member_id: @membership.user_id,
          from: previous,
          to: @membership.role
        )
      end

      @membership
    end
  end
end
