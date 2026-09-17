# frozen_string_literal: true

class CreateNodeRelationships < ActiveRecord::Migration[8.1]
  def change
    create_table :node_relationships do |t|
      # Denormalized from the endpoints on purpose.
      #
      # Every relationship's space is derivable from either node, but storing it makes
      # "all edges in this space" a single index scan instead of two joins -- and that is
      # the query the canvas runs on every load. The model enforces that it agrees with
      # both endpoints.
      t.references :documentation_space, null: false, foreign_key: true, index: false

      t.references :source_node, null: false, foreign_key: { to_table: :nodes }, index: false
      t.references :target_node, null: false, foreign_key: { to_table: :nodes }, index: true

      # A string, not an enum: `contains`, `depends_on`, `calls`, `reads_from`,
      # `writes_to`, `publishes_to`, `subscribes_to`, `references` and `related_to` are the
      # starting vocabulary, but a team documenting its own system will want its own verbs
      # and must not need a migration to get them.
      t.string :relationship_type, null: false

      # Per-edge annotation: protocol, cardinality, criticality, renderer hints.
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    # The canvas loads every edge for a space; neighborhood expansion loads the edges
    # leaving one node. One composite index answers both, which is why the plain
    # source_node index is omitted above.
    add_index :node_relationships, [ :documentation_space_id, :source_node_id ]

    # The same pair may be connected more than once, but not twice by the same verb:
    # "API calls Database" is one fact, and a duplicate row is a bug, not a second edge.
    add_index :node_relationships,
              [ :source_node_id, :target_node_id, :relationship_type ],
              unique: true,
              name: "index_node_relationships_on_endpoints_and_type"

    # A node relating to itself is always a mistake in this domain, and it renders as a
    # degenerate edge. Rejected in the database so no code path can create one.
    add_check_constraint :node_relationships,
                         "source_node_id <> target_node_id",
                         name: "node_relationships_no_self_reference"

    add_check_constraint :node_relationships,
                         "jsonb_typeof(metadata) = 'object'",
                         name: "node_relationships_metadata_is_object"
  end
end
