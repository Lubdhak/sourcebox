# frozen_string_literal: true

# Storage for collaboratively edited node content.
#
# The server does not understand what is in these columns, and that is the design rather
# than a shortcut. Conflict resolution happens in the CRDT library running in each
# browser; Rails stores an opaque byte log and relays it. Teaching Ruby to merge Yjs
# updates would mean a second implementation of the merge algorithm that has to agree
# with the first one exactly, forever.
#
# Two tables because the log has two different lifetimes. `crdt_updates` is append-only
# and grows with every few keystrokes; `crdt_documents` holds one merged snapshot so a
# joiner does not have to replay a month of editing. Compaction folds the first into the
# second and is performed by a client, which is the only participant that can merge.
class CreateCrdtDocuments < ActiveRecord::Migration[8.1]
  def change
    create_table :crdt_documents do |t|
      # One document per node, holding the text of all its blocks. Per node rather than
      # per block because block creation, deletion and reordering are themselves
      # concurrent edits: with a document per block, two people adding a paragraph at the
      # same time would be editing two documents that nothing reconciles.
      t.references :node, null: false, foreign_key: { on_delete: :cascade }, index: { unique: true }

      # The merged state as of `snapshot_seq`. Null until the first compaction, when the
      # log is short enough to replay in full.
      t.binary :snapshot
      t.bigint :snapshot_seq, null: false, default: 0

      t.timestamps
    end

    create_table :crdt_updates do |t|
      t.references :crdt_document, null: false, foreign_key: { on_delete: :cascade }

      # One CRDT update, exactly as the client encoded it.
      t.binary :payload, null: false

      # Attribution, for a future "who wrote this line". Nullable because a user can be
      # deleted while their words remain, and nullifying is the right answer there.
      t.references :actor, null: true, foreign_key: { to_table: :users, on_delete: :nullify }

      t.datetime :created_at, null: false
    end

    # The read path is always "everything in this document after sequence N", where the
    # sequence is the update's own id. The primary key supplies the ordering; this index
    # supplies the scoping.
    add_index :crdt_updates, [ :crdt_document_id, :id ]
  end
end
