# frozen_string_literal: true

module Types
  # Exposed as `ContentBlockInput`.
  #
  # Used both to create a block on a new node and to update one on an existing node: the
  # editor makes no distinction, so neither does the input.
  class ContentBlockInputType < Types::BaseInputObject
    graphql_name "ContentBlockInput"
    description "A content block to create or update."

    argument :block_type, Types::ContentBlockTypeEnum,
             description: "Determines the required shape of `data`."

    argument :data, GraphQL::Types::JSON,
             description: <<~DESC
               The payload, validated server-side against the shape declared for
               `blockType`. Unknown keys are preserved, so renderer hints do not need a
               schema change; missing or wrongly typed required keys are rejected with a
               field error.
             DESC
  end
end
