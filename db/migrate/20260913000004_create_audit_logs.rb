# frozen_string_literal: true

class CreateAuditLogs < ActiveRecord::Migration[8.1]
  def change
    create_table :audit_logs do |t|
      t.string :event_name, null: false

      # No foreign keys here on purpose: an audit trail must outlive the records it
      # describes, so deleting a dashboard or user must not cascade away the history
      # of what they did.
      t.bigint :dashboard_id
      t.bigint :user_id

      # Correlates an audit row back to the HTTP request that caused it.
      t.string :request_id

      # Which keys changed, never their values. This keeps the trail useful for
      # forensics without turning it into a long-lived copy of user data.
      t.jsonb :changed_keys, null: false, default: []

      t.datetime :occurred_at, null: false

      t.timestamps
    end

    # The two access patterns: "what happened to this dashboard" and "what happened
    # during this request".
    add_index :audit_logs, [ :dashboard_id, :occurred_at ]
    add_index :audit_logs, :request_id
  end
end
