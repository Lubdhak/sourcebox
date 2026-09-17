# frozen_string_literal: true

module Mutations
  class RevokeSpaceAccess < BaseMutation
    description <<~DESC
      Remove someone's access to a space, or withdraw an invitation they never claimed.

      Their work stays. Nodes and blocks record who wrote them rather than
      belonging to them, so this removes the ability to read and write, not the
      documentation.
    DESC

    argument :membership_id, ID, description: "The access to remove."

    field :revoked_membership_id, ID, description: "The id that no longer exists."

    def resolve(membership_id:)
      membership = SpaceMembership.find_by(id: membership_id)
      raise ApplicationGraphql::NotFoundError if membership.nil?

      authorize_space!(membership.documentation_space, :admin)

      Documentation::RevokeAccess.call(
        membership: membership,
        actor: current_user,
        request_id: context[:request_id]
      )

      { revoked_membership_id: membership_id.to_s }
    end
  end
end
