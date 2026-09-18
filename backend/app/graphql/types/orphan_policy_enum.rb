# frozen_string_literal: true

module Types
  # Exposed as `OrphanPolicy`.
  class OrphanPolicyEnum < Types::BaseEnum
    graphql_name "OrphanPolicy"

    description <<~DESC
      What happens to the nodes filed inside the ones being deleted.

      This replaces the `cascade` boolean, which asked the same question in database
      terms. A node inside the selection that also lives somewhere else is unaffected by
      either choice -- it keeps its other home and only loses this one.
    DESC

    value "KEEP", value: Documentation::DeletionPolicy::ORPHANS_KEEP,
          description: <<~VALUE
            The contents survive, re-homed into whatever contained the deleted node.

            What someone tidying a grouping wants: the grouping goes, the work filed under
            it does not. With nothing above it, the contents rise to the top of the space.
          VALUE
    value "DELETE", value: Documentation::DeletionPolicy::ORPHANS_DELETE,
          description: <<~VALUE
            The contents are deleted as part of the same operation.

            What someone retiring a whole subsystem wants.
          VALUE
  end
end
