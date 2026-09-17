# frozen_string_literal: true

class CreateLayers < ActiveRecord::Migration[8.1]
  def change
    create_table :layers do |t|
      t.references :documentation_space, null: false, foreign_key: true, index: true

      # The conceptual depth of the layer: 0 = System, 1 = Services, 2 = Modules, and so
      # on. Deliberately NOT the graph hierarchy -- a node on layer 3 may relate to a node
      # on layer 0. This is a filtering and zoom dimension, nothing more.
      t.integer :index, null: false

      t.string :name, null: false
      t.text :description

      t.timestamps
    end

    # One layer per depth per space, so "zoom to layer 2" has exactly one answer.
    add_index :layers, [ :documentation_space_id, :index ], unique: true
  end
end
