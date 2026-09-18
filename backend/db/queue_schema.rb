# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_09_18_000003) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "audit_logs", force: :cascade do |t|
    t.jsonb "changed_keys", default: [], null: false
    t.datetime "created_at", null: false
    t.bigint "dashboard_id"
    t.string "event_name", null: false
    t.datetime "occurred_at", null: false
    t.string "request_id"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["dashboard_id", "occurred_at"], name: "index_audit_logs_on_dashboard_id_and_occurred_at"
    t.index ["request_id"], name: "index_audit_logs_on_request_id"
  end

  create_table "change_proposals", force: :cascade do |t|
    t.bigint "author_id", null: false
    t.datetime "created_at", null: false
    t.datetime "decided_at"
    t.text "decision_note"
    t.bigint "documentation_space_id", null: false
    t.text "failure_reason"
    t.string "intent", null: false
    t.jsonb "payload", default: {}, null: false
    t.bigint "reviewer_id"
    t.string "status", default: "pending", null: false
    t.string "summary", null: false
    t.datetime "updated_at", null: false
    t.index ["author_id", "status"], name: "index_change_proposals_on_author_and_status"
    t.index ["documentation_space_id", "status", "created_at"], name: "index_change_proposals_on_space_and_status"
    t.check_constraint "(status::text = 'pending'::text) = (decided_at IS NULL)", name: "change_proposals_decision_has_a_time"
    t.check_constraint "jsonb_typeof(payload) = 'object'::text", name: "change_proposals_payload_is_object"
    t.check_constraint "status::text = ANY (ARRAY['pending'::character varying::text, 'approved'::character varying::text, 'rejected'::character varying::text, 'failed'::character varying::text])", name: "change_proposals_status_is_known"
  end

  create_table "content_blocks", force: :cascade do |t|
    t.string "block_type", null: false
    t.datetime "created_at", null: false
    t.jsonb "data", default: {}, null: false
    t.bigint "node_id", null: false
    t.integer "position", null: false
    t.virtual "search_vector", type: :tsvector, as: "jsonb_to_tsvector('english'::regconfig, data, '[\"string\"]'::jsonb)", stored: true
    t.datetime "updated_at", null: false
    t.index ["node_id", "position"], name: "index_content_blocks_on_node_id_and_position", unique: true
    t.index ["search_vector"], name: "index_content_blocks_on_search_vector", using: :gin
    t.check_constraint "\"position\" >= 0", name: "content_blocks_position_is_non_negative"
    t.check_constraint "jsonb_typeof(data) = 'object'::text", name: "content_blocks_data_is_object"
  end

  create_table "crdt_documents", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "node_id", null: false
    t.binary "snapshot"
    t.bigint "snapshot_seq", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["node_id"], name: "index_crdt_documents_on_node_id", unique: true
  end

  create_table "crdt_updates", force: :cascade do |t|
    t.bigint "actor_id"
    t.bigint "crdt_document_id", null: false
    t.datetime "created_at", null: false
    t.binary "payload", null: false
    t.index ["actor_id"], name: "index_crdt_updates_on_actor_id"
    t.index ["crdt_document_id", "id"], name: "index_crdt_updates_on_crdt_document_id_and_id"
    t.index ["crdt_document_id"], name: "index_crdt_updates_on_crdt_document_id"
  end

  create_table "dashboards", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.jsonb "ui_state", default: {}, null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["user_id"], name: "index_dashboards_on_user_id"
    t.check_constraint "jsonb_typeof(ui_state) = 'object'::text", name: "dashboards_ui_state_is_object"
  end

  create_table "documentation_spaces", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.uuid "public_id", default: -> { "gen_random_uuid()" }, null: false
    t.jsonb "settings", default: {}, null: false
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["public_id"], name: "index_documentation_spaces_on_public_id", unique: true
    t.index ["user_id", "slug"], name: "index_documentation_spaces_on_user_id_and_slug", unique: true
    t.index ["user_id"], name: "index_documentation_spaces_on_user_id"
    t.check_constraint "jsonb_typeof(settings) = 'object'::text", name: "documentation_spaces_settings_is_object"
  end

  create_table "node_relationships", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "documentation_space_id", null: false
    t.jsonb "metadata", default: {}, null: false
    t.string "relationship_type", null: false
    t.bigint "source_node_id", null: false
    t.bigint "target_node_id", null: false
    t.datetime "updated_at", null: false
    t.index ["documentation_space_id", "source_node_id"], name: "idx_on_documentation_space_id_source_node_id_83d36790f2"
    t.index ["source_node_id", "target_node_id", "relationship_type"], name: "index_node_relationships_on_endpoints_and_type", unique: true
    t.index ["target_node_id"], name: "index_node_relationships_on_target_node_id"
    t.check_constraint "jsonb_typeof(metadata) = 'object'::text", name: "node_relationships_metadata_is_object"
    t.check_constraint "source_node_id <> target_node_id", name: "node_relationships_no_self_reference"
  end

  create_table "nodes", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "deleted_at"
    t.bigint "deleted_by_id"
    t.float "depth", default: 0.0, null: false
    t.bigint "documentation_space_id", null: false
    t.float "height", default: 120.0, null: false
    t.jsonb "metadata", default: {}, null: false
    t.virtual "search_vector", type: :tsvector, as: "to_tsvector('english'::regconfig, (((COALESCE(title, ''::character varying))::text || ' '::text) || COALESCE(summary, ''::text)))", stored: true
    t.text "summary"
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.float "width", default: 240.0, null: false
    t.float "x", default: 0.0, null: false
    t.float "y", default: 0.0, null: false
    t.float "z", default: 0.0, null: false
    t.index ["documentation_space_id", "deleted_at"], name: "index_nodes_on_space_and_deleted_at"
    t.index ["documentation_space_id", "x", "y"], name: "index_nodes_on_documentation_space_id_and_x_and_y"
    t.index ["search_vector"], name: "index_nodes_on_search_vector", using: :gin
    t.check_constraint "jsonb_typeof(metadata) = 'object'::text", name: "nodes_metadata_is_object"
  end

  create_table "solid_queue_batch_executions", force: :cascade do |t|
    t.bigint "batch_id", null: false
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.index ["batch_id"], name: "index_solid_queue_batch_executions_on_batch_id"
    t.index ["job_id"], name: "index_solid_queue_batch_executions_on_job_id", unique: true
  end

  create_table "solid_queue_batches", force: :cascade do |t|
    t.string "active_job_batch_id"
    t.integer "completed_jobs", default: 0, null: false
    t.datetime "created_at", null: false
    t.string "description"
    t.datetime "enqueued_at"
    t.datetime "failed_at"
    t.integer "failed_jobs", default: 0, null: false
    t.datetime "finished_at"
    t.text "metadata"
    t.text "on_failure"
    t.text "on_finish"
    t.text "on_success"
    t.integer "total_jobs", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["active_job_batch_id"], name: "index_solid_queue_batches_on_active_job_batch_id", unique: true
    t.index ["finished_at"], name: "index_solid_queue_batches_on_finished_at"
  end

  create_table "solid_queue_blocked_executions", force: :cascade do |t|
    t.string "concurrency_key", null: false
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.bigint "job_id", null: false
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.index ["concurrency_key", "priority", "job_id"], name: "index_solid_queue_blocked_executions_for_release"
    t.index ["expires_at", "concurrency_key"], name: "index_solid_queue_blocked_executions_for_maintenance"
    t.index ["job_id"], name: "index_solid_queue_blocked_executions_on_job_id", unique: true
  end

  create_table "solid_queue_claimed_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.bigint "process_id"
    t.index ["job_id"], name: "index_solid_queue_claimed_executions_on_job_id", unique: true
    t.index ["process_id", "job_id"], name: "index_solid_queue_claimed_executions_on_process_id_and_job_id"
  end

  create_table "solid_queue_failed_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "error"
    t.bigint "job_id", null: false
    t.index ["job_id"], name: "index_solid_queue_failed_executions_on_job_id", unique: true
  end

  create_table "solid_queue_jobs", force: :cascade do |t|
    t.string "active_job_id"
    t.text "arguments"
    t.bigint "batch_id"
    t.string "class_name", null: false
    t.string "concurrency_key"
    t.datetime "created_at", null: false
    t.datetime "finished_at"
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.datetime "scheduled_at"
    t.datetime "updated_at", null: false
    t.index ["active_job_id"], name: "index_solid_queue_jobs_on_active_job_id"
    t.index ["batch_id"], name: "index_solid_queue_jobs_on_batch_id"
    t.index ["class_name"], name: "index_solid_queue_jobs_on_class_name"
    t.index ["finished_at"], name: "index_solid_queue_jobs_on_finished_at"
    t.index ["queue_name", "finished_at"], name: "index_solid_queue_jobs_for_filtering"
    t.index ["scheduled_at", "finished_at"], name: "index_solid_queue_jobs_for_alerting"
  end

  create_table "solid_queue_pauses", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "queue_name", null: false
    t.index ["queue_name"], name: "index_solid_queue_pauses_on_queue_name", unique: true
  end

  create_table "solid_queue_processes", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "hostname"
    t.string "kind", null: false
    t.datetime "last_heartbeat_at", null: false
    t.text "metadata"
    t.string "name", null: false
    t.integer "pid", null: false
    t.bigint "supervisor_id"
    t.index ["last_heartbeat_at"], name: "index_solid_queue_processes_on_last_heartbeat_at"
    t.index ["name", "supervisor_id"], name: "index_solid_queue_processes_on_name_and_supervisor_id", unique: true
    t.index ["supervisor_id"], name: "index_solid_queue_processes_on_supervisor_id"
  end

  create_table "solid_queue_ready_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.index ["job_id"], name: "index_solid_queue_ready_executions_on_job_id", unique: true
    t.index ["priority", "job_id"], name: "index_solid_queue_poll_all"
    t.index ["queue_name", "priority", "job_id"], name: "index_solid_queue_poll_by_queue"
  end

  create_table "solid_queue_recurring_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.datetime "run_at", null: false
    t.string "task_key", null: false
    t.index ["job_id"], name: "index_solid_queue_recurring_executions_on_job_id", unique: true
    t.index ["task_key", "run_at"], name: "index_solid_queue_recurring_executions_on_task_key_and_run_at", unique: true
  end

  create_table "solid_queue_recurring_tasks", force: :cascade do |t|
    t.text "arguments"
    t.string "class_name"
    t.string "command", limit: 2048
    t.datetime "created_at", null: false
    t.text "description"
    t.string "key", null: false
    t.integer "priority", default: 0
    t.string "queue_name"
    t.string "schedule", null: false
    t.boolean "static", default: true, null: false
    t.datetime "updated_at", null: false
    t.index ["key"], name: "index_solid_queue_recurring_tasks_on_key", unique: true
    t.index ["static"], name: "index_solid_queue_recurring_tasks_on_static"
  end

  create_table "solid_queue_scheduled_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.datetime "scheduled_at", null: false
    t.index ["job_id"], name: "index_solid_queue_scheduled_executions_on_job_id", unique: true
    t.index ["scheduled_at", "priority", "job_id"], name: "index_solid_queue_dispatch_all"
  end

  create_table "solid_queue_semaphores", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "key", null: false
    t.datetime "updated_at", null: false
    t.integer "value", default: 1, null: false
    t.index ["expires_at"], name: "index_solid_queue_semaphores_on_expires_at"
    t.index ["key", "value"], name: "index_solid_queue_semaphores_on_key_and_value"
    t.index ["key"], name: "index_solid_queue_semaphores_on_key", unique: true
  end

  create_table "space_memberships", force: :cascade do |t|
    t.datetime "accepted_at"
    t.datetime "created_at", null: false
    t.bigint "documentation_space_id", null: false
    t.bigint "invited_by_id"
    t.string "invited_email"
    t.string "role", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index "documentation_space_id, lower((invited_email)::text)", name: "index_space_memberships_on_space_and_email", unique: true, where: "(invited_email IS NOT NULL)"
    t.index "lower((invited_email)::text)", name: "index_space_memberships_on_pending_email", where: "(user_id IS NULL)"
    t.index ["documentation_space_id", "user_id"], name: "index_space_memberships_on_space_and_user", unique: true, where: "(user_id IS NOT NULL)"
    t.index ["user_id"], name: "index_space_memberships_on_user_id"
    t.check_constraint "(user_id IS NOT NULL) <> (invited_email IS NOT NULL)", name: "space_memberships_identifies_exactly_one_person"
    t.check_constraint "role::text = ANY (ARRAY['viewer'::character varying::text, 'contributor'::character varying::text, 'editor'::character varying::text, 'admin'::character varying::text])", name: "space_memberships_role_is_known"
  end

  create_table "users", force: :cascade do |t|
    t.string "avatar_url"
    t.datetime "created_at", null: false
    t.datetime "current_sign_in_at"
    t.string "current_sign_in_ip"
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.datetime "last_sign_in_at"
    t.string "last_sign_in_ip"
    t.string "name"
    t.string "provider"
    t.datetime "remember_created_at"
    t.datetime "reset_password_sent_at"
    t.string "reset_password_token"
    t.integer "sign_in_count", default: 0, null: false
    t.string "uid"
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["provider", "uid"], name: "index_users_on_provider_and_uid", unique: true, where: "((provider IS NOT NULL) AND (uid IS NOT NULL))"
    t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
  end

  add_foreign_key "change_proposals", "documentation_spaces"
  add_foreign_key "change_proposals", "users", column: "author_id"
  add_foreign_key "change_proposals", "users", column: "reviewer_id"
  add_foreign_key "content_blocks", "nodes"
  add_foreign_key "crdt_documents", "nodes", on_delete: :cascade
  add_foreign_key "crdt_updates", "crdt_documents", on_delete: :cascade
  add_foreign_key "crdt_updates", "users", column: "actor_id", on_delete: :nullify
  add_foreign_key "dashboards", "users"
  add_foreign_key "documentation_spaces", "users"
  add_foreign_key "node_relationships", "documentation_spaces"
  add_foreign_key "node_relationships", "nodes", column: "source_node_id"
  add_foreign_key "node_relationships", "nodes", column: "target_node_id"
  add_foreign_key "nodes", "documentation_spaces"
  add_foreign_key "nodes", "users", column: "deleted_by_id", on_delete: :nullify
  add_foreign_key "solid_queue_batch_executions", "solid_queue_batches", column: "batch_id", on_delete: :cascade
  add_foreign_key "solid_queue_batch_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_blocked_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_claimed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_failed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_ready_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_recurring_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_scheduled_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "space_memberships", "documentation_spaces"
  add_foreign_key "space_memberships", "users"
  add_foreign_key "space_memberships", "users", column: "invited_by_id"
end
