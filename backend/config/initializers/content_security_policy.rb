# frozen_string_literal: true

# Content Security Policy.
#
# This has to be asset-host aware. The frontend is a separately deployable container, so
# in production the HTML comes from the Rails origin while every script and stylesheet
# comes from ASSET_HOST. A policy of `script_src :self` would block the entire
# application the moment the frontend is split out.
#
# Ships in report-only mode unless CSP_ENFORCE is set. A CSP that is wrong fails by
# blanking the page, and the only reliable way to find the gaps is to collect real
# violations from real browsers first. Turn on enforcement once the report endpoint is
# quiet:
#
#   CSP_ENFORCE=1
Rails.application.configure do
  asset_host = ENV["ASSET_HOST"].presence

  # In development, Vite serves modules and the HMR client from its own container.
  vite_dev_origins =
    if Rails.env.development?
      port = ENV.fetch("VITE_RUBY_PORT", "3036")
      [ "http://localhost:#{port}", "http://127.0.0.1:#{port}" ]
    else
      []
    end

  vite_dev_websockets =
    if Rails.env.development?
      port = ENV.fetch("VITE_RUBY_PORT", "3036")
      [ "ws://localhost:#{port}", "ws://127.0.0.1:#{port}" ]
    else
      []
    end

  config.content_security_policy do |policy|
    policy.default_src :self

    policy.script_src  :self, asset_host, *vite_dev_origins
    policy.style_src   :self, asset_host, *vite_dev_origins,
                       # Vite injects <style> blocks in development, and some component
                       # libraries set inline styles. Scoped to styles only: an inline
                       # style is a far smaller risk than inline script.
                       :unsafe_inline
    policy.font_src    :self, asset_host, :data
    policy.connect_src :self, asset_host, *vite_dev_origins, *vite_dev_websockets

    # Google profile pictures come from lh3.googleusercontent.com, and the seed data uses
    # pravatar. `https:` for images is a deliberate, low-risk relaxation -- an image
    # cannot execute.
    policy.img_src     :self, :data, :https

    policy.object_src  :none
    policy.base_uri    :self

    # This application is never meant to be framed. Blocks clickjacking outright, and is
    # the modern replacement for X-Frame-Options.
    policy.frame_ancestors :none

    # Login posts to our own OAuth request-phase route, which then redirects to Google, so
    # :self is sufficient here.
    policy.form_action :self
  end

  # A nonce for the one inline script we legitimately emit: vite_react_refresh_tag passes
  # `nonce: true`, so React Refresh works in development without :unsafe_inline.
  config.content_security_policy_nonce_generator = ->(request) { request.session.id.to_s }
  config.content_security_policy_nonce_directives = %w[script-src]

  config.content_security_policy_report_only = !ENV["CSP_ENFORCE"].present?
end
