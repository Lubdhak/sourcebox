# frozen_string_literal: true

class RemoveNodeTypeFromNodes < ActiveRecord::Migration[8.1]
  def change
    remove_column :nodes, :node_type, :string
  end
end
