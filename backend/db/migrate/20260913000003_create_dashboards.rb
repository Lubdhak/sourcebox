# frozen_string_literal: true

class CreateDashboards < ActiveRecord::Migration[8.1]
  def change
    create_table :dashboards do |t|
      # Foreign key plus NOT NULL: a dashboard without an owner is unauthorizable,
      # and authorization is enforced by ownership.
      t.references :user, null: false, foreign_key: true, index: true

      t.jsonb :ui_state, null: false, default: {}

      t.timestamps
    end

    # Structural guard at the database boundary. Model validations cover the shape of
    # the document, but this makes it impossible for a console session, a backfill
    # script or a future code path to store a JSON scalar or array where the
    # application requires an object.
    add_check_constraint :dashboards,
                         "jsonb_typeof(ui_state) = 'object'",
                         name: "dashboards_ui_state_is_object"

    # Deliberately NO GIN index on ui_state.
    #
    # A GIN index earns its cost only when you filter *inside* the document across
    # many rows -- `ui_state @> '{"theme":"dark"}'` or `ui_state ? 'widgets'`. Every
    # read in this application is by primary key or by user_id, which the
    # `index_dashboards_on_user_id` btree above already answers. Adding GIN here would
    # only add write amplification on a row that is updated on every UI toggle.
    #
    # When you do start querying by content, add:
    #   add_index :dashboards, :ui_state, using: :gin, opclass: :jsonb_path_ops
    # `jsonb_path_ops` is smaller and faster than the default `jsonb_ops`, at the cost
    # of only supporting containment (@>) rather than key-existence (?) operators.
  end
end
