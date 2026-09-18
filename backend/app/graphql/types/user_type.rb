# frozen_string_literal: true

module Types
  class UserType < Types::BaseObject
    description "An authenticated user."

    field :id, ID
    field :email, String
    field :name, String, description: "Display name, falling back to the email local part."
    field :avatar_url, String, null: true, description: "Google profile image URL."
    field :provider, String, null: true, description: "Identity provider, when signed up via OAuth."
    field :created_at, GraphQL::Types::ISO8601DateTime

    def name
      object.display_name
    end
  end
end
