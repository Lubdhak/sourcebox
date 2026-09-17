require_relative "boot"

require "rails"
# Only the frameworks this application actually uses. Active Storage, Action Text and
# Action Mailbox are deliberately absent: no uploads (avatars are remote URLs), no rich
# text, no inbound mail.
#
# Action Cable is here because documentation spaces are edited by many people at once.
# Everything else in this stack answers a request and forgets; collaboration is the one
# feature that cannot, because a change made in one browser has to reach every other
# browser looking at the same space without anyone pressing refresh.
require "action_cable/engine"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_mailer/railtie"
require "action_view/railtie"
require "rails/test_unit/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Sourcebox
  class Application < Rails::Application
    config.load_defaults 8.1

    config.autoload_lib(ignore: %w[assets tasks])

    # Everything is UTC internally; formatting for a user's timezone is a view concern.
    config.time_zone = "UTC"
    config.active_record.default_timezone = :utc

    # --- Background jobs ------------------------------------------------
    #
    # PostgreSQL-backed, zero Redis. `connects_to` points Solid Queue at the separate
    # `queue` database defined in config/database.yml, keeping high-churn job traffic out
    # of the primary's autovacuum, WAL and backups.
    config.active_job.queue_adapter = :solid_queue
    config.solid_queue.connects_to = { database: { writing: :queue } }

    # Surface job errors through Rails' error reporter so one subscriber sees application
    # and background failures alike.
    config.solid_queue.on_thread_error = ->(exception) do
      Rails.error.report(exception, handled: false, source: "solid_queue")
    end

    # --- Realtime -------------------------------------------------------
    #
    # Same shape as the queue: a PostgreSQL-backed adapter pointed at its own database, so
    # realtime message churn does not land in the primary's WAL or its backups. Solid
    # Cable takes that pointer from config/cable.yml rather than from here.
    #
    # Origin checking stays on. Without it any page on the internet could open a socket to
    # this server carrying the user's session cookie, which is the WebSocket equivalent of
    # skipping CSRF protection. The permitted list is per environment, since only the
    # environment knows what the app is served from.
    config.action_cable.mount_path = "/cable"

    # --- Generators -----------------------------------------------------
    config.generators.system_tests = nil
    config.generators do |g|
      g.helper false
      g.assets false
    end

    # --- Logging --------------------------------------------------------
    #
    # Parameters scrubbed from logs everywhere Rails logs them. Rails.event payloads are
    # scrubbed separately and more aggressively by Logging::Redactor.
    config.filter_parameters += %i[
      password password_confirmation secret token _key crypt salt certificate otp ssn
      access_token refresh_token id_token client_secret authenticity_token
    ]
  end
end
