# frozen_string_literal: true

module Mutations
  class ChangeMemberRole < BaseMutation
    description "Change what one member may do in a space."

    argument :membership_id, ID, description: "The access to change."
    argument :role, Types::SpaceRoleEnum, description: "The new role. `OWNER` is not assignable."

    field :membership, Types::SpaceMembershipType, description: "The updated access."

    def resolve(membership_id:, role:)
      membership = find_membership!(membership_id)

      if role == "owner"
        raise ApplicationGraphql::ValidationError.new(
          "Ownership cannot be transferred this way.",
          fields: { role: [ "cannot be owner" ] }
        )
      end

      { membership: Documentation::ChangeMemberRole.call(
        membership: membership,
        role: role,
        actor: current_user,
        request_id: context[:request_id]
      ) }
    rescue ActiveRecord::RecordInvalid => error
      validation_error!(error.record)
    end

    private

    # Memberships are addressed by sequential id, so the space has to be authorized
    # before the row is trusted -- otherwise an id from another space would be editable
    # by anyone who is an admin of any space at all.
    def find_membership!(membership_id)
      membership = SpaceMembership.find_by(id: membership_id)
      raise ApplicationGraphql::NotFoundError if membership.nil?

      authorize_space!(membership.documentation_space, :admin)

      membership
    end
  end
end
