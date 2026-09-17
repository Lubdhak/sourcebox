# frozen_string_literal: true

module Types
  # Exposed as `SpaceRole`.
  class SpaceRoleEnum < Types::BaseEnum
    # Without this the type is named after the class, and clients have to write
    # `SpaceRoleEnum` in their variable declarations -- the `Enum` suffix is a Ruby
    # naming convention, not part of the API. Same reason ContentBlockTypeEnum renames
    # itself to `ContentBlockType`.
    graphql_name "SpaceRole"

    description <<~DESC
      What a person may do in a space.

      An enum rather than a string, so an unknown role is rejected by the schema before
      it reaches a check that might interpret it generously.
    DESC

    value "VIEWER", value: "viewer", description: "Read the graph. Cannot change anything."
    value "EDITOR", value: "editor", description: "Change the graph directly."
    value "ADMIN", value: "admin",
          description: "Everything an editor can do, plus managing who else has access."
    value "OWNER", value: "owner",
          description: <<~VALUE
            Created the space. Cannot be changed or removed, which is what guarantees a
            space always has someone who can restore access. Never assignable.
          VALUE
  end
end
