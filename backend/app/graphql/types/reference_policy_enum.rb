# frozen_string_literal: true

module Types
  # Exposed as `ReferencePolicy`.
  class ReferencePolicyEnum < Types::BaseEnum
    graphql_name "ReferencePolicy"

    description <<~DESC
      What happens to the things pointing at the deleted nodes.

      Covers both kinds of pointer: a typed edge in the graph, and an `@`-mention written
      into another node's page. The second is the one that used to be missed -- it lives
      in a content block and no foreign key protects it.
    DESC

    value "PRESERVE", value: Documentation::DeletionPolicy::REFERENCES_PRESERVE,
          description: <<~VALUE
            Leave every pointer as it is.

            Correct alongside a soft delete: the nodes can come back, and a mention that
            was flattened to plain text cannot be turned back into a link.
          VALUE
    value "REMOVE", value: Documentation::DeletionPolicy::REFERENCES_REMOVE,
          description: <<~VALUE
            Drop the edges and flatten the mentions to plain text.

            The wording survives, the link does not, so nothing is left pointing at
            something that is no longer there.
          VALUE
  end
end
