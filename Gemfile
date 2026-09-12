source "https://rubygems.org"

ruby file: ".ruby-version"

# --- Core ---------------------------------------------------------------
gem "rails", "~> 8.1.3", ">= 8.1.3.1"
gem "pg", "~> 1.6"
gem "puma", "~> 8.0"

# Reduces boot times through caching; required in config/boot.rb
gem "bootsnap", require: false

# Windows does not include zoneinfo files, so bundle the tzinfo-data gem
gem "tzinfo-data", platforms: %i[windows jruby]

# --- API layer ----------------------------------------------------------
# Single GraphQL endpoint. No REST duplication, no separate Node service.
gem "graphql", "~> 2.6"

# --- Frontend bridge ----------------------------------------------------
# Inertia protocol v3. Vite owns app/frontend; Propshaft/Importmap are not installed.
gem "inertia_rails", "~> 3.22"
gem "vite_rails", "~> 3.11"

# --- Authentication -----------------------------------------------------
gem "devise", "~> 5.0"
gem "omniauth-google-oauth2", "~> 1.2"
# Required: OmniAuth 2.x rejects a GET request phase (CVE-2015-9284), so the
# provider redirect must be a POST carrying a valid authenticity token.
gem "omniauth-rails_csrf_protection", "~> 2.0"

# --- Background jobs ----------------------------------------------------
# PostgreSQL-backed. Zero Redis: no redis, sidekiq, resque, rabbitmq or kafka.
gem "solid_queue", "~> 1.7"

group :development, :test do
  gem "debug", platforms: %i[mri windows], require: "debug/prelude"
  gem "brakeman", require: false
  gem "bundler-audit", require: false
  gem "rubocop-rails-omakase", require: false
end

group :development do
  gem "web-console"
end
