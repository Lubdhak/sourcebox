# frozen_string_literal: true

module Types
  # Exposed as `DeletionMode`.
  class DeletionModeEnum < Types::BaseEnum
    graphql_name "DeletionMode"

    description <<~DESC
      Whether a deletion can be undone.

      An enum rather than a boolean because the two answers are not opposites of one
      value: they differ in what happens to the row, to the references and to the
      recoverability, and a `permanent: true` flag would leave a reader guessing which.
    DESC

    value "SOFT", value: Documentation::DeletionPolicy::MODE_SOFT,
          description: "The nodes stop appearing anywhere but the rows are kept and can be restored."
    value "HARD", value: Documentation::DeletionPolicy::MODE_HARD,
          description: "The nodes, their content and their edges are destroyed. Not recoverable."
  end
end
