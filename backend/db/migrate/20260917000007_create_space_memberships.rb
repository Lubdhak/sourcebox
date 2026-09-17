# frozen_string_literal: true

class CreateSpaceMemberships < ActiveRecord::Migration[8.1]
  def change
    create_table :space_memberships do |t|
      t.references :documentation_space, null: false, foreign_key: true, index: false

      # Null while the invitation is outstanding. Sharing is done by email address, and
      # the person on the other end may not have an account yet -- refusing to share with
      # them until they sign up would make the feature useless exactly when it matters,
      # at the moment someone is trying to bring a colleague in.
      t.references :user, null: true, foreign_key: true, index: true

      # Held only until the invitation is claimed, then cleared: once a membership points
      # at a user, the address is the user's business and keeping a stale copy here would
      # mean access surviving an email change.
      t.string :invited_email

      t.string :role, null: false

      # Kept for the audit trail. Nullified rather than cascaded, because who granted
      # access remains a fact about the grant after the granter's account is gone.
      t.references :invited_by, null: true, foreign_key: { to_table: :users }, index: false

      t.datetime :accepted_at

      t.timestamps
    end

    # One membership per person per space, whether they arrived by invitation or claim.
    add_index :space_memberships, [ :documentation_space_id, :user_id ],
              unique: true,
              where: "user_id IS NOT NULL",
              name: "index_space_memberships_on_space_and_user"

    # Addresses are compared case-insensitively, so the uniqueness rule has to be too --
    # otherwise Ada@example.com and ada@example.com are two invitations to one person,
    # and revoking one leaves the other.
    add_index :space_memberships, "documentation_space_id, lower(invited_email)",
              unique: true,
              where: "invited_email IS NOT NULL",
              name: "index_space_memberships_on_space_and_email"

    # Claiming looks up every outstanding invitation for an address at sign-in.
    add_index :space_memberships, "lower(invited_email)",
              where: "user_id IS NULL",
              name: "index_space_memberships_on_pending_email"

    add_check_constraint :space_memberships,
                         "role IN ('viewer', 'contributor', 'editor', 'admin')",
                         name: "space_memberships_role_is_known"

    # A membership is either claimed or outstanding; it can never be neither, which would
    # be a row granting access to nobody that no one can see to revoke.
    add_check_constraint :space_memberships,
                         "(user_id IS NOT NULL) <> (invited_email IS NOT NULL)",
                         name: "space_memberships_identifies_exactly_one_person"
  end
end
