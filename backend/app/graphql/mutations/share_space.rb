# frozen_string_literal: true

module Mutations
  class ShareSpace < BaseMutation
    description <<~DESC
      Give someone access to a space by email address.

      The address does not have to belong to an account yet. An invitation to an unknown
      address waits as a pending membership and becomes real access the first time that
      person signs in, so sharing never depends on the recipient having signed up first.

      Re-sharing with someone who already has access changes their role rather than
      failing, because that is what the person clicking "add" meant.
    DESC

    argument :space_id, ID, description: "The space to share."
    argument :email, String, description: "Who to share it with."
    argument :role, Types::SpaceRoleEnum, description: "What they may do. `OWNER` is not assignable."

    field :membership, Types::SpaceMembershipType, description: "The access that now exists."
    field :memberships, [ Types::SpaceMembershipType ], description: "Everyone with access, after the change."

    def resolve(space_id:, email:, role:)
      space = authorize_space_by_public_id!(space_id, :admin)
      reject_owner_role!(role)

      membership = Documentation::ShareSpace.call(
        space: space,
        email: email,
        role: role,
        actor: current_user,
        request_id: context[:request_id]
      )

      { membership: membership, memberships: space.space_memberships.reload.order(:created_at).to_a }
    rescue ActiveRecord::RecordInvalid => error
      validation_error!(error.record)
    end

    private

    # Ownership is a property of the space, not a grant, so there is no such thing as
    # adding a second owner. The enum has to contain the value in order to *report* it,
    # which is exactly why it has to be refused here.
    def reject_owner_role!(role)
      return unless role == "owner"

      raise ApplicationGraphql::ValidationError.new(
        "Ownership cannot be shared. Grant admin instead.",
        fields: { role: [ "cannot be owner" ] }
      )
    end
  end
end
