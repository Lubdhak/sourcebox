# frozen_string_literal: true

class CreateNodes < ActiveRecord::Migration[8.1]
  def change
    create_table :nodes do |t|
      t.references :documentation_space, null: false, foreign_key: true, index: false

      # Nullable: a node does not have to belong to a layer, and losing its layer must not
      # lose the node. Nullify rather than cascade for the same reason.
      t.references :layer, foreign_key: { on_delete: :nullify }, index: true

      # A string rather than an enum column. The set of things a user might document
      # (service, table, team, business rule, external system) is open-ended by design,
      # so a new type must not require a migration. The model holds a suggested
      # vocabulary; it does not close the set.
      t.string :node_type, null: false, default: "concept"

      t.string :title, null: false
      t.text :summary

      # Spatial position. `z` is persisted from day one even though the first renderer is
      # 2.5D: it costs 8 bytes and it is the difference between adding a third dimension
      # later and migrating every row in a large space to get it.
      t.float :x, null: false, default: 0.0
      t.float :y, null: false, default: 0.0
      t.float :z, null: false, default: 0.0

      # Renderer-owned extents, persisted so a resized node keeps its shape across
      # reloads and across renderers. `depth` is the z-axis counterpart of width/height.
      t.float :width, null: false, default: 240.0
      t.float :height, null: false, default: 120.0
      t.float :depth, null: false, default: 0.0

      # Genuinely open-ended per-node annotation: owning team, status, external ids,
      # renderer hints. Bounded by the model rather than schema-validated.
      t.jsonb :metadata, null: false, default: {}

      # Full-text search over the node's own words.
      #
      # A generated column rather than an expression index or a trigger: PostgreSQL
      # maintains it, so no application code can forget to, and it can be selected
      # directly when ranking results. `to_tsvector` with a literal configuration is
      # immutable, which is what makes it legal in a generated column.
      t.virtual :search_vector,
                type: :tsvector,
                as: "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))",
                stored: true

      t.timestamps
    end

    # The primary read pattern is "every node in this space", optionally narrowed to one
    # layer. A single composite index answers both, so the plain space index is omitted
    # above (`index: false`) rather than duplicated.
    add_index :nodes, [ :documentation_space_id, :layer_id ]

    # Viewport queries: "nodes inside this rectangle". A btree on (space, x, y) lets
    # PostgreSQL narrow by space and range-scan x, which is enough for the loading
    # strategy here. A GiST index over a point would be faster for true 2D range queries
    # and is the upgrade path if viewport loading becomes the bottleneck.
    add_index :nodes, [ :documentation_space_id, :x, :y ]

    add_check_constraint :nodes,
                         "jsonb_typeof(metadata) = 'object'",
                         name: "nodes_metadata_is_object"

    add_index :nodes, :search_vector, using: :gin
  end
end
