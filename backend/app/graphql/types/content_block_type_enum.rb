# frozen_string_literal: true

module Types
  # Exposed as the `ContentBlockType` enum.
  #
  # An enum here and a plain String for `Node#nodeType` and
  # `NodeRelationship#relationshipType`, which looks inconsistent but is not. A block type
  # is closed: the server validates its payload shape per type and the frontend has one
  # renderer per type, so a value it does not know about is meaningless and should be
  # rejected during query validation. A node type and a relationship verb are open by
  # design -- nobody can enumerate what a team might document or how they relate things.
  class ContentBlockTypeEnum < Types::BaseEnum
    graphql_name "ContentBlockType"
    description "The kind of content a block holds, which determines the shape of its data."

    # Derived from the model so the enum and the payload validation cannot disagree.
    ContentBlock::TYPES.each do |type|
      value type.upcase, value: type, description: "A #{type.humanize.downcase} block."
    end
  end
end
