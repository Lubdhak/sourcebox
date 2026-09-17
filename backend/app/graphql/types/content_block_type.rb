# frozen_string_literal: true

module Types
  # Exposed as `ContentBlock`.
  #
  # `data` is a JSON scalar, and this is the one place in the documentation schema where
  # that is the right answer rather than a shortcut. The whole point of the block model is
  # that a table, a code snippet and a Markdown body are the same kind of thing with
  # different payloads; typing each payload as its own GraphQL object would mean twelve
  # union members, a schema change per new block type, and a client that has to select
  # every variant it might encounter.
  #
  # What keeps it honest: `blockType` is an enum, and the server validates `data` against
  # a declared shape per type (ContentBlock::SHAPES). So the payload is unstructured on
  # the wire but not unvalidated in the database.
  class ContentBlockType < Types::BaseObject
    description "A typed piece of content inside a node."

    field :id, ID, description: "Globally unique identifier."

    field :block_type, Types::ContentBlockTypeEnum,
          description: "Determines how the block renders and what shape `data` has."

    field :position, Integer,
          description: "Display order within the node, 0-based and contiguous."

    field :data, GraphQL::Types::JSON,
          description: <<~DESC
            The block's payload.

            Shape depends on `blockType` and is validated server-side, for example
            `{ "markdown": "..." }`, `{ "columns": [...], "rows": [[...]] }`, or
            `{ "code": "...", "language": "ruby" }`. Every type also accepts an optional
            `title`.
          DESC

    field :preview, String,
          description: "A short plain-text rendering of the payload, for lists and search results."

    field :created_at, GraphQL::Types::ISO8601DateTime
    field :updated_at, GraphQL::Types::ISO8601DateTime

    def id
      object.id.to_s
    end
  end
end
