# frozen_string_literal: true

class CreateDocumentationSpaces < ActiveRecord::Migration[8.1]
  def change
    create_table :documentation_spaces do |t|
      # A space is the authorization boundary for the whole graph beneath it. Every node,
      # relationship, layer and content block is reached through a space, and this is the
      # only place ownership is recorded -- so it has to be NOT NULL.
      t.references :user, null: false, foreign_key: true, index: true

      # Spaces are addressed in URLs, and sequential ids would let anyone walk the
      # keyspace to discover how many spaces exist and probe for other tenants'.
      # Children need no such column: they are only ever reachable through an already
      # authorized space.
      t.uuid :public_id, null: false, default: -> { "gen_random_uuid()" }

      t.string :name, null: false
      t.string :slug, null: false
      t.text :description

      # Space-level preferences owned by the client (default layer, background grid,
      # relationship colours). Bounded by the model, same as dashboards.ui_state.
      t.jsonb :settings, null: false, default: {}

      t.timestamps
    end

    add_index :documentation_spaces, :public_id, unique: true

    # Unique per owner, not globally: two users may both have a "Payment Platform".
    add_index :documentation_spaces, [ :user_id, :slug ], unique: true

    add_check_constraint :documentation_spaces,
                         "jsonb_typeof(settings) = 'object'",
                         name: "documentation_spaces_settings_is_object"
  end
end
