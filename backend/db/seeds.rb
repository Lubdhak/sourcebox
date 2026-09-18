# frozen_string_literal: true

# Seed data for demo/onboarding accounts.
#
# Idempotent by design: `db:prepare` runs this whenever it creates the database, and
# `./dev seed` can be run repeatedly. Everything uses find_or_create_by/update so
# re-running converges instead of duplicating or raising.
#
# Allowed to run in production, but ONLY with an explicit, non-default password supplied
# via DEMO_SEED_PASSWORD. The literal string "saas" below is public (committed to this
# file) and must never be the actual password for an account that exists in a real
# deployment — that would let anyone who has read this file sign in to production.
if Rails.env.production?
  warn "Seeding production. Accounts below will exist with the password from DEMO_SEED_PASSWORD."
end

# Creating users here does fire User's after_create_commit hook, which emits
# `user.created` and enqueues NotificationJob and AnalyticsEventJob. That is left in
# place on purpose: it gives a fresh checkout a few jobs on the queue, so `./dev up` shows
# the worker doing real work instead of idling.
#
# "saas" is short and memorable on purpose for local/dev use, because its only job there is
# to be typed by hand during a demo. It is far below Devise's configured minimum
# (config.password_length), which is why the save below skips validation — see the comment
# there. In production this default is never used: DEMO_SEED_PASSWORD is required instead.
DEMO_PASSWORD = if Rails.env.production?
  ENV.fetch("DEMO_SEED_PASSWORD") do
    raise "Refusing to seed production without DEMO_SEED_PASSWORD set. Set a strong, " \
          "non-public password for the seeded accounts before running db:seed here."
  end
else
  ENV.fetch("DEMO_SEED_PASSWORD", "saas")
end

SEED_USERS = [
  {
    email: "ada@sourcebox.dev",
    name: "Ada Lovelace",
    provider: "google_oauth2",
    uid: "seed-uid-ada-0001",
    avatar_url: "https://i.pravatar.cc/200?u=ada@sourcebox.dev",
  },
  {
    email: "grace@sourcebox.dev",
    name: "Grace Hopper",
    provider: "google_oauth2",
    uid: "seed-uid-grace-0002",
    avatar_url: "https://i.pravatar.cc/200?u=grace@sourcebox.dev",
  },
  {
    # The account to reach for when demoing. Password sign-in, so it works without Google
    # OAuth credentials configured.
    email: "lubi@gmail.com",
    name: "Lubi",
    provider: nil,
    uid: nil,
    avatar_url: nil,
  },
  {
    # No provider/uid: a password-signup account, so the partial unique index on
    # (provider, uid) is exercised alongside the OAuth rows.
    email: "alan@sourcebox.dev",
    name: "Alan Turing",
    provider: nil,
    uid: nil,
    avatar_url: nil,
  },
].freeze

puts "Seeding #{SEED_USERS.size} users…"

SEED_USERS.each do |attrs|
  user = User.find_or_initialize_by(email: attrs.fetch(:email))
  user.assign_attributes(
    name: attrs[:name],
    provider: attrs[:provider],
    uid: attrs[:uid],
    avatar_url: attrs[:avatar_url]
  )
  # Assigned whenever it does not already match, rather than only on create. A re-run on an
  # unchanged database stays a no-op, but changing DEMO_PASSWORD converges the accounts that
  # already exist — otherwise the banner this file prints would promise a password that no
  # seeded account actually accepts.
  unless user.encrypted_password.present? && user.valid_password?(DEMO_PASSWORD)
    user.password = DEMO_PASSWORD
  end

  # DEMO_PASSWORD is deliberately shorter than Devise's minimum (config.password_length),
  # so validation would reject it. Skipping validation is the narrow fix; the alternative
  # is lowering that minimum, which would weaken the password policy for real accounts in
  # every environment in order to make a development fixture convenient.
  #
  # Everything unrelated to the password is still validated, because the point of skipping
  # is to allow a short password — not to let a genuine mistake in the seed data through.
  user.validate
  blocking = user.errors.reject { |error| error.attribute == :password }
  if blocking.any?
    raise "Seed user #{attrs.fetch(:email)} is invalid: #{blocking.map(&:full_message).join(', ')}"
  end

  user.save!(validate: false)

  puts "  #{user.email.ljust(24)} id=#{user.id}"
end

load Rails.root.join("db/seeds/documentation.rb")

puts <<~SUMMARY

  Seeded.

    Users:      #{User.count}
    Doc spaces: #{DocumentationSpace.count} (#{Node.count} nodes, #{NodeRelationship.count} relationships)

  Password sign-in for any seeded account:  #{Rails.env.production? ? "(set via DEMO_SEED_PASSWORD, not logged)" : DEMO_PASSWORD}
  Google sign-in still requires real GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.

SUMMARY
