# frozen_string_literal: true

class DropLayers < ActiveRecord::Migration[8.1]
  def up
    # Detach nodes from layers before dropping the table.
    # The foreign key has on_delete: :nullify, but we remove it explicitly here
    # so the column removal is clean.
    remove_foreign_key :nodes, :layers
    remove_column :nodes, :layer_id

    # Remove the index that referenced the now-gone column.
    # (Rails may have already removed it with the column, but guard anyway.)
    remove_index :nodes, name: "index_nodes_on_documentation_space_id_and_layer_id", if_exists: true
    remove_index :nodes, name: "index_nodes_on_layer_id", if_exists: true

    # Drop the layers table itself.
    remove_foreign_key :layers, :documentation_spaces
    drop_table :layers
  end

  def down
    create_table :layers do |t|
      t.text     :description
      t.bigint   :documentation_space_id, null: false
      t.integer  :index, null: false
      t.string   :name, null: false
      t.timestamps

      t.index [:documentation_space_id, :index], unique: true, name: "index_layers_on_documentation_space_id_and_index"
      t.index :documentation_space_id, name: "index_layers_on_documentation_space_id"
    end

    add_foreign_key :layers, :documentation_spaces

    add_column :nodes, :layer_id, :bigint
    add_index :nodes, [:documentation_space_id, :layer_id], name: "index_nodes_on_documentation_space_id_and_layer_id"
    add_index :nodes, :layer_id, name: "index_nodes_on_layer_id"
    add_foreign_key :nodes, :layers, on_delete: :nullify
  end
end
