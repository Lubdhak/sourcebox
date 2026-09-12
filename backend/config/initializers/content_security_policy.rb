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

  # In development the frontend container serves modules and the HMR client from its own
  # origin, so that origin has to be allowed explicitly for scripts, styles and the
  # websocket.
  dev_server = ENV["VITE_DEV_SERVER_URL"].presence

  vite_dev_origins = dev_server ? [ dev_server ] : []

  # The HMR websocket is the same host and port over ws://. connect-src does not inherit
  # from script-src, so it must be listed separately or hot reloading fails while
  # everything else works -- a confusing failure worth avoiding.
  vite_dev_websockets =
    if dev_server
      uri = URI.parse(dev_server)
      [ "ws://#{uri.host}:#{uri.port}" ]
    else
      []
    end

  # Compacted before being splatted: Rails raises
  # `ArgumentError: Invalid content security policy source: nil` rather than ignoring a nil
  # source, and asset_host is legitimately nil in development.
  sources = ->(*values) { values.flatten.compact }

  config.content_security_policy do |policy|
    policy.default_src :self

    policy.script_src(*sources.call(:self, asset_host, vite_dev_origins))
    policy.style_src(*sources.call(
      :self, asset_host, vite_dev_origins,
      # Vite injects <style> blocks in development, and some component libraries set
      # inline styles. Scoped to styles only: an inline style is a far smaller risk than
      # inline script.
      :unsafe_inline
    ))
    policy.font_src(*sources.call(:self, asset_host, :data))
    policy.connect_src(*sources.call(:self, asset_host, vite_dev_origins, vite_dev_websockets))

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
