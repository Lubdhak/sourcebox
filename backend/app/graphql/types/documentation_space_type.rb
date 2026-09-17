# frozen_string_literal: true

module Types
  # Exposed as `DocumentationSpace`.
  class DocumentationSpaceType < Types::BaseObject
    description "One documentation graph: its nodes, relationships, layers and content."

    field :id, ID,
          description: <<~DESC
            The space's public identifier, a UUID.

            Not the database id. Spaces are addressed in URLs, and a sequential id would
            let anyone walk the keyspace. Nodes and blocks keep their numeric ids because
            they are only ever reachable through an already authorized space.
          DESC

    field :name, String
    field :slug, String, description: "URL-friendly name, unique per owner."
    field :description, String, null: true

    field :settings, GraphQL::Types::JSON,
          description: "Space-level client preferences: default layer, grid, edge styling."

    field :layers, [ Types::LayerType ],
          description: "Conceptual layers, shallowest first."

    field :graph, Types::SpaceGraphType,
          description: "Nodes and the edges between them, filtered and bounded." do
      argument :layer_id, ID, required: false,
               description: "Return only nodes on this layer."
      argument :viewport, Types::ViewportInputType, required: false,
               description: "Return only nodes inside this rectangle."
      argument :limit, Integer, required: false,
               description: "Maximum nodes to return. Capped server-side; see `truncated`."
      argument :focus_node_id, ID, required: false,
               description: <<~DESC
                 Descend into this node: return what it contains instead of the space.

                 A focus that no longer exists is treated as no focus rather than as an
                 error, so a collaborator deleting the node someone is inside lands them
                 at the top of the space instead of on a failure.
               DESC
    end

    field :viewer_role, Types::SpaceRoleEnum,
          description: "What the signed-in user may do here. Drives which controls the client offers."

    field :memberships, [ Types::SpaceMembershipType ],
          description: <<~DESC
            Everyone with access, including outstanding invitations.

            Empty unless the viewer is an admin or the owner. Who else can read a
            document is not public information within it -- a viewer being able to
            enumerate a team's addresses through a space they were shown once is a
            leak, not a feature.
          DESC

    field :created_at, GraphQL::Types::ISO8601DateTime
    field :updated_at, GraphQL::Types::ISO8601DateTime

    def id
      object.public_id
    end

    def viewer_role
      object.role_for(context[:current_user])
    end

    def memberships
      return [] unless administrator?

      object.space_memberships.includes(:user).order(:created_at).to_a
    end

    def layers
      load_association(DocumentationSpace, :layers).sort_by(&:index)
    end

    # Authorization already happened at the field that resolved this space, so the
    # snapshot does not re-check it. What it does enforce is scoping: every query inside
    # it starts from `space.nodes`, so no filter argument can reach outside this space.
    def graph(layer_id: nil, viewport: nil, limit: nil, focus_node_id: nil)
      Documentation::GraphSnapshot.call(
        space: object,
        layer_id: layer_id.presence,
        viewport: viewport&.to_h,
        limit: limit || Documentation::GraphSnapshot::DEFAULT_LIMIT,
        focus_node_id: focus_node_id.presence
      )
    end

    private

    def administrator?
      object.permits?(context[:current_user], :admin)
    end
  end
end
