# frozen_string_literal: true

module Mutations
  class DeleteRelationship < BaseDocumentationMutation
    description "Remove one edge. Both nodes it connected are left untouched."

    argument :relationship_id, ID, description: "The edge to delete."

    field :deleted_relationship_id, ID, null: true,
          description: "The id of the removed edge."

    def resolve(relationship_id:)
      relationship = authorize_within_space!(NodeRelationship.find_by(id: relationship_id), :write)

      deleted_id = Documentation::DeleteRelationship.call(
        relationship: relationship,
        actor: current_user,
        request_id: context[:request_id]
      )

      { deleted_relationship_id: deleted_id.to_s }
    end
  end
end
