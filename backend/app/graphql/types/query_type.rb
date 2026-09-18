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

    field :documentation_spaces, Types::DocumentationSpaceType.connection_type,
          description: "Documentation spaces the signed-in user owns or has been given access to."

    field :documentation_space, Types::DocumentationSpaceType,
          description: "Fetch one space by its public id. Requires access to it." do
      argument :id, ID, description: "The space's public id (a UUID)."
    end

    field :node, Types::NodeType,
          description: "Fetch one node by id, authorized through the space that contains it." do
      argument :id, ID, description: "The node id."
    end

    field :nodes_deletion_impact, Types::NodeDeletionImpactType,
          description: <<~DESC do
            What deleting these nodes would do, under this policy.

            The single source of truth for deletion consequences. Serves one node and
            twenty identically -- a single deletion is a selection of one -- and is
            re-requested whenever the user changes a policy option, because the answer
            changes with it. The client never derives these numbers itself.
          DESC
      argument :node_ids, [ ID ], description: "The nodes that might be deleted."
      argument :deletion_mode, Types::DeletionModeEnum, required: false,
               description: "Whether the deletion would be recoverable. Defaults to `SOFT`."
      argument :reference_policy, Types::ReferencePolicyEnum, required: false,
               description: "What would happen to pointers at these nodes. Defaults to match the mode."
      argument :orphan_policy, Types::OrphanPolicyEnum, required: false,
               description: "What would happen to the nodes filed inside these. Defaults to `KEEP`."
    end

    field :search_documentation, [ Types::DocumentationSearchResultType ],
          description: "Full-text search across one space's nodes and their content." do
      argument :space_id, ID, description: "The space to search. Only the owner may search it."
      argument :query, String, description: "What the user typed. Bare words, \"quoted phrases\", `or` and `-negation` are understood."
      argument :limit, Integer, required: false, description: "Maximum results. Capped server-side."
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

    # Scoped in SQL rather than filtered after loading, so there is no code path where
    # an inaccessible space is fetched and then discarded. A connection, so a user with
    # many spaces cannot ask for all of them at once.
    def documentation_spaces
      require_authentication!

      current_user.accessible_documentation_spaces.alphabetical
    end

    def documentation_space(id:)
      authorize_space_by_public_id!(id)
    end

    # The node is looked up globally and then authorized through its space, which is the
    # only reason `authorize_within_space!` exists. A node belonging to somebody else
    # raises the same NOT_FOUND as one that does not exist, so this field cannot be used
    # to discover which node ids are real.
    def node(id:)
      authorize_within_space!(Node.find_by(id: id))
    end

    # Every node is authorized individually before any of them is read, because a
    # selection is client-supplied and one id from another tenant's space would otherwise
    # be enough to have this report that space's shape back.
    def nodes_deletion_impact(node_ids:, deletion_mode: nil, reference_policy: nil, orphan_policy: nil)
      nodes = Array(node_ids).uniq.map { |id| authorize_within_space!(Node.find_by(id: id), :write) }

      Documentation::NodeDeletion.new(
        nodes: nodes,
        policy: Documentation::DeletionPolicy.new(
          mode: deletion_mode,
          reference_policy: reference_policy,
          orphan_policy: orphan_policy
        ),
        actor: current_user
      ).impact
    end

    def search_documentation(space_id:, query:, limit: nil)
      space = authorize_space_by_public_id!(space_id)

      Documentation::Search.call(
        space: space,
        query: query,
        limit: limit || 25
      )
    end
  end
end
