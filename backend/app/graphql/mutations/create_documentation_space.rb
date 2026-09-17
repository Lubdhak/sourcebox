# frozen_string_literal: true

module Mutations
  # Creates a documentation space owned by the signed-in user.
  #
  # Note the shape shared by every mutation in this file's neighbourhood: authorize,
  # delegate to one operation, return. No graph logic, no event emission, no transaction
  # management -- those belong to the operation, where the console, the seeds and any
  # future importer can reach them too.
  class CreateDocumentationSpace < BaseMutation
    description "Create a documentation space, with the default conceptual layers."

    argument :name, String, description: "Display name. The slug is derived from it."
    argument :description, String, required: false, description: "What this space documents."
    argument :settings, GraphQL::Types::JSON, required: false,
             description: "Space-level client preferences. Bounded server-side."

    field :documentation_space, Types::DocumentationSpaceType, description: "The new space."

    def resolve(name:, description: nil, settings: nil)
      # No ownership check to make: the space does not exist yet, and it is created for
      # the authenticated user rather than for a user named in the arguments.
      space = Documentation::CreateSpace.call(
        user: current_user,
        name: name,
        description: description,
        settings: settings || {},
        request_id: context[:request_id]
      )

      { documentation_space: space }
    end
  end
end
