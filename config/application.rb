require_relative "boot"

require "rails"
# Only the frameworks this application actually uses. Action Cable, Active Storage,
# Action Text and Action Mailbox are deliberately absent: no WebSockets, no uploads
# (avatars are remote URLs), no rich text, no inbound mail.
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
