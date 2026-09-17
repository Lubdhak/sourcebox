# frozen_string_literal: true

module Types
  # Exposed as `SpaceMembership`.
  class SpaceMembershipType < Types::BaseObject
    description <<~DESC
      One person's access to a space, or an outstanding invitation to it.

      A membership with `pending: true` names an email address that has no account yet
      -- or has one that has not signed in since being invited. It becomes ordinary
      access the first time that person signs in.
    DESC

    field :id, ID
    field :role, Types::SpaceRoleEnum, description: "What this person may do in the space."
    field :pending, Boolean, description: "True until the invitation has been claimed by a sign-in."
    field :name, String, description: "Display name, or the local part of the invited address."
    field :email, String, description: "Where the invitation went, or the member's account email."
    field :user_id, ID, null: true, description: "Null while the invitation is outstanding."
    field :invited_at, GraphQL::Types::ISO8601DateTime, description: "When access was granted."

    def id
      object.id.to_s
    end

    def pending
      object.pending?
    end

    def name
      object.display_name
    end

    def user_id
      object.user_id&.to_s
    end

    def invited_at
      object.created_at
    end
  end
end
