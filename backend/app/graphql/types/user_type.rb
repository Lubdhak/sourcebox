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

    field :dashboards, Types::DashboardType.connection_type,
          description: "Dashboards owned by this user."

    def name
      object.display_name
    end

    # A connection rather than a plain list, so the field can never return an unbounded
    # result set. The schema's default_max_page_size caps `first`/`last` even if a client
    # asks for more.
    #
    # Batched via the association loader: resolving `dashboards` for several users costs
    # one preload rather than one query per user.
    def dashboards
      load_association(User, :dashboards)
    end
  end
end
