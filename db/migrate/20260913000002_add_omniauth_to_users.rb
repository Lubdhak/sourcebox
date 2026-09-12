# frozen_string_literal: true

class AddOmniauthToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :provider,   :string
    add_column :users, :uid,        :string
    add_column :users, :avatar_url, :string
    add_column :users, :name,       :string

    # One local account per external identity.
    #
    # Partial index on purpose: accounts created by password signup have NULL
    # provider/uid, and in PostgreSQL every NULL is distinct, so a plain unique index
    # would technically permit unlimited NULL rows but would also index them for no
    # benefit. Restricting the index to rows that actually have an identity keeps it
    # small and makes the constraint express exactly what we mean.
    #
    # This index is also what makes User.from_google's RecordNotUnique rescue a real
    # concurrency guarantee rather than a hopeful retry.
    add_index :users, [ :provider, :uid ],
              unique: true,
              where: "provider IS NOT NULL AND uid IS NOT NULL",
              name: "index_users_on_provider_and_uid"
  end
end
