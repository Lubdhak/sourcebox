# frozen_string_literal: true

# Devise 5 configuration.
#
# Only settings that differ from the defaults, or that matter for security, are listed.
# The stock generated file is ~330 lines of commented defaults; carrying those around
# makes real decisions harder to see.
Devise.setup do |config|
  require "devise/orm/active_record"

  config.mailer_sender = ENV.fetch("MAILER_SENDER", "no-reply@sourcebox.local")

  config.case_insensitive_keys = [ :email ]
  config.strip_whitespace_keys = [ :email ]

  # HTTP auth has no session to store; everything else does.
  config.skip_session_storage = [ :http_auth ]

  # bcrypt cost. 12 is a reasonable 2026 default; tests drop to 1 so the suite is not
  # dominated by key stretching.
  config.stretches = Rails.env.test? ? 1 : 12

  # Changing an email address must be confirmed on the NEW address before it takes
  # effect, so a mistyped or hostile address cannot lock the owner out.
  config.reconfirmable = true

  # Invalidate remember-me cookies everywhere on sign-out rather than only in the
  # current browser.
  config.expire_all_remember_me_on_sign_out = true
  config.remember_for = 2.weeks

  # NIST SP 800-63B favours length over composition rules.
  config.password_length = 12..128
  config.reset_password_within = 6.hours

  # Do not disclose whether an address is registered. Without this, the login and
  # password-reset forms are an account-enumeration oracle.
  config.paranoid = true

  # A destructive action must not be reachable by link prefetch or <img src>.
  config.sign_out_via = :delete

  # Rack 3.1 deprecated :unprocessable_entity in favour of :unprocessable_content.
  config.responder.error_status = :unprocessable_content
  config.responder.redirect_status = :see_other

  # Inertia navigations are XHR requests that expect the HTML/redirect flow rather
  # than a JSON error body.
  config.navigational_formats = [ "*/*", :html ]

  # NOTE: Devise 5 removed SecretKeyFinder and always derives Devise.secret_key from
  # Rails' secret_key_base. SECRET_KEY_BASE must therefore be stable across deploys:
  # rotating it invalidates every outstanding reset/confirmation token.
end
