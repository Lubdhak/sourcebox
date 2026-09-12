# frozen_string_literal: true

module Types
  class QueryType < Types::BaseObject
    description "Root query."

    field :current_user, Types::UserType,
          null: true,
          description: "The signed-in user, or null when there is no session."

    field :dashboard, Types::DashboardType,
          description: "Fetch one dashboard by id. Only the owner may read it." do
      argument :id, ID, description: "The dashboard id."
    end

    # Null rather than an error for an anonymous request: "who am I" is a legitimate
    # question with a legitimate answer of "nobody". The frontend uses this to decide
    # whether to render a signed-in shell.
    def current_user
      context[:current_user]
    end

    # Authorization happens here, at the boundary, not in the frontend.
    #
    # `authorize_owner!` raises NOT_FOUND both when the dashboard does not exist and when
    # it belongs to somebody else, so this field cannot be used to discover which ids are
    # real.
    def dashboard(id:)
      authorize_owner!(Dashboard.find_by(id: id))
    end
  end
end
