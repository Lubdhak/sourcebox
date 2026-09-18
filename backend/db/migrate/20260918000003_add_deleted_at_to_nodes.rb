# frozen_string_literal: true

class AddDeletedAtToNodes < ActiveRecord::Migration[8.1]
  def change
    # Soft deletion. Null means live, a timestamp means removed-but-recoverable.
    #
    # A column rather than a `deleted_nodes` table because every graph query already
    # filters by space and would otherwise need a UNION to see both. Node#default_scope
    # honours it, so no read path has to remember.
    add_column :nodes, :deleted_at, :datetime

    # Who did it, for the audit trail. Nullified rather than cascaded: losing the actor
    # must not resurrect the node.
    add_reference :nodes, :deleted_by, foreign_key: { to_table: :users, on_delete: :nullify }, index: false

    # Partial: the only question ever asked of this column is "which rows are live", and
    # live rows are the overwhelming majority, so indexing the timestamps themselves
    # would be dead weight on every insert.
    add_index :nodes, [ :documentation_space_id, :deleted_at ],
              name: "index_nodes_on_space_and_deleted_at"
  end
end
