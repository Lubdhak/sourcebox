# frozen_string_literal: true

class CreateContentBlocks < ActiveRecord::Migration[8.1]
  def change
    create_table :content_blocks do |t|
      t.references :node, null: false, foreign_key: true, index: false

      # One table for every block type, not one table per type.
      #
      # A `text` block, a `table` block and a `code` block differ only in the shape of
      # their payload, and that shape is what changes most often. Twelve near-empty tables
      # would buy column-level typing for data the renderer has to branch on anyway, at
      # the cost of a migration for every new block type and a twelve-way union on every
      # read. The shape is validated in the model, per type, instead.
      t.string :block_type, null: false

      # Display order within a node, 0-based and contiguous.
      t.integer :position, null: false

      # The block's payload. `{ "type": ..., "data": ... }` from the specification splits
      # here: the type is a column because it is queried and indexed, the data is JSONB
      # because its shape is per-type.
      t.jsonb :data, null: false, default: {}

      # Full-text search over the block's payload.
      #
      # The `["string"]` filter indexes string leaves only, at any depth, so a Markdown
      # body, a code snippet and the cells of a table all become searchable without the
      # application having to know how to walk each payload shape. The regconfig overload
      # is immutable, which is what allows it in a generated column.
      t.virtual :search_vector,
                type: :tsvector,
                as: "jsonb_to_tsvector('english', data, '[\"string\"]')",
                stored: true

      t.timestamps
    end

    # Blocks are always read as "the whole node's content, in order".
    add_index :content_blocks, [ :node_id, :position ], unique: true

    add_index :content_blocks, :search_vector, using: :gin

    add_check_constraint :content_blocks,
                         "jsonb_typeof(data) = 'object'",
                         name: "content_blocks_data_is_object"

    add_check_constraint :content_blocks,
                         "position >= 0",
                         name: "content_blocks_position_is_non_negative"
  end
end
