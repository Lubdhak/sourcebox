# frozen_string_literal: true

# Development seed data.
#
# Idempotent by design: `db:prepare` runs this whenever it creates the database, and
# `./dev seed` can be run repeatedly. Everything uses find_or_create_by/update so
# re-running converges instead of duplicating or raising.
#
# Refuses to run in production. Seeds create users with known passwords, which is exactly
# the kind of thing that must never appear in a real environment.
if Rails.env.production?
  warn "Refusing to seed in production."
  exit 1
end

# Creating users here does fire User's after_create_commit hook, which emits
# `user.created` and enqueues NotificationJob and AnalyticsEventJob. That is left in
# place on purpose: it gives a fresh checkout a few jobs on the queue, so `./dev up` shows
# the worker doing real work instead of idling.
# Short and memorable on purpose, because its only job is to be typed by hand during a
# demo. It is far below Devise's configured minimum (config.password_length), which is why
# the save below skips validation — see the comment there.
DEMO_PASSWORD = "saas"

SEED_USERS = [
  {
    email: "ada@sourcebox.dev",
    name: "Ada Lovelace",
    provider: "google_oauth2",
    uid: "seed-uid-ada-0001",
    avatar_url: "https://i.pravatar.cc/200?u=ada@sourcebox.dev",
    ui_state: {
      "theme" => "dark",
      "layout" => "grid",
      "visibleWidgets" => %w[revenue signups latency],
      "widgetSettings" => {
        "revenue" => { "currency" => "USD", "range" => "30d", "compare" => true },
        "signups" => { "range" => "7d" },
        "latency" => { "percentile" => "p95" },
      },
    },
  },
  {
    email: "grace@sourcebox.dev",
    name: "Grace Hopper",
    provider: "google_oauth2",
    uid: "seed-uid-grace-0002",
    avatar_url: "https://i.pravatar.cc/200?u=grace@sourcebox.dev",
    ui_state: {
      "theme" => "light",
      "layout" => "list",
      "visibleWidgets" => %w[latency revenue],
      "widgetSettings" => {
        "latency" => { "percentile" => "p99", "alertThresholdMs" => 250 },
      },
    },
  },
  {
    # The account to reach for when demoing. Password sign-in, so it works without Google
    # OAuth credentials configured.
    email: "lubi@gmail.com",
    name: "Lubi",
    provider: nil,
    uid: nil,
    avatar_url: nil,
    ui_state: {
      "theme" => "dark",
      "layout" => "grid",
      "visibleWidgets" => %w[revenue signups latency],
      "widgetSettings" => {
        "revenue" => { "currency" => "USD", "range" => "7d" },
      },
    },
  },
  {
    # No provider/uid: a password-signup account, so the partial unique index on
    # (provider, uid) is exercised alongside the OAuth rows.
    email: "alan@sourcebox.dev",
    name: "Alan Turing",
    provider: nil,
    uid: nil,
    avatar_url: nil,
    ui_state: {
      "theme" => "system",
      "layout" => "grid",
      "visibleWidgets" => %w[signups],
      "widgetSettings" => {},
    },
  },
].freeze

puts "Seeding #{SEED_USERS.size} users…"

SEED_USERS.each do |attrs|
  ui_state = attrs.fetch(:ui_state)

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

  dashboard = user.dashboards.order(:created_at).first || user.dashboards.new
  dashboard.ui_state = ui_state
  dashboard.save!

  # A little audit history so the dashboard has something to show and the append-only
  # model is exercised.
  next if AuditLog.where(dashboard_id: dashboard.id).exists?

  3.times do |i|
    AuditLog.create!(
      event_name: Events::Names::DASHBOARD_UPDATED,
      dashboard_id: dashboard.id,
      user_id: user.id,
      request_id: "seed-#{SecureRandom.hex(6)}",
      changed_keys: [ %w[theme], %w[layout], %w[visibleWidgets widgetSettings] ][i],
      occurred_at: (3 - i).days.ago
    )
  end

  puts "  #{user.email.ljust(24)} dashboard=#{dashboard.id} theme=#{dashboard.theme}"
end

load Rails.root.join("db/seeds/documentation.rb")

puts <<~SUMMARY

  Seeded.

    Users:      #{User.count}
    Dashboards: #{Dashboard.count}
    Audit rows: #{AuditLog.count}
    Doc spaces: #{DocumentationSpace.count} (#{Node.count} nodes, #{NodeRelationship.count} relationships)

  Password sign-in for any seeded account:  #{DEMO_PASSWORD}
  Google sign-in still requires real GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.

SUMMARY
