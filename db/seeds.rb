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

# Bypass the after_create_commit event while seeding: it would enqueue a welcome email
# and analytics job for every fixture user.
DEMO_PASSWORD = "sourcebox-dev-password"

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
  user.password = DEMO_PASSWORD if user.new_record?
  user.save!

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

puts <<~SUMMARY

  Seeded.

    Users:      #{User.count}
    Dashboards: #{Dashboard.count}
    Audit rows: #{AuditLog.count}

  Password sign-in for any seeded account:  #{DEMO_PASSWORD}
  Google sign-in still requires real GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.

SUMMARY
