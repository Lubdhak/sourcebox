# frozen_string_literal: true

# Removes the dashboard feature.
#
# The application has one subject -- the documentation graph -- and the dashboard was a
# second one with its own page, model, GraphQL surface and landing redirect. Deleting the
# code without dropping the table would leave a `dashboards` row for every account and a
# column in `audit_logs` pointing at a table nothing writes to.
#
# `audit_logs` itself stays: its columns (event name, user, request id, changed keys) are
# generic, and the point of an append-only trail is that it outlives the feature it was
# first written for. Only the dangling reference goes.
class DropDashboards < ActiveRecord::Migration[8.1]
  def up
    remove_index :audit_logs, column: [ :dashboard_id, :occurred_at ]
    remove_column :audit_logs, :dashboard_id

    drop_table :dashboards
  end

  def down
    create_table :dashboards do |t|
      t.references :user, null: false, foreign_key: true
      t.jsonb :ui_state, null: false, default: {}

      t.timestamps
    end

    add_check_constraint :dashboards,
                         "jsonb_typeof(ui_state) = 'object'",
                         name: "dashboards_ui_state_is_object"

    add_column :audit_logs, :dashboard_id, :bigint
    add_index :audit_logs, [ :dashboard_id, :occurred_at ]
  end
end
