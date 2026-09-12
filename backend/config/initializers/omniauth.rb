# frozen_string_literal: true

# Google OAuth2 via Devise's :omniauthable module.
#
# Registered through `Devise.setup` rather than by inserting OmniAuth::Builder into the
# middleware stack directly. Devise already inserts and configures that middleware for
# every provider listed here, and adds the routes
#
#   GET/POST /users/auth/google_oauth2           (request phase)
#   GET      /users/auth/google_oauth2/callback  (callback phase)
#
# Building the middleware by hand as well would install the strategy twice.
Devise.setup do |config|
  config.omniauth :google_oauth2,
                  ENV.fetch("GOOGLE_CLIENT_ID", ""),
                  ENV.fetch("GOOGLE_CLIENT_SECRET", ""),
                  {
                    # Only what we use. Every additional scope is shown on the consent
                    # screen and widens the blast radius of a token leak.
                    scope: "email,profile",

                    # Always let the user choose an account; avoids silently reusing a
                    # session on a shared machine.
                    prompt: "select_account",

                    # We store an avatar URL, so ask for a square image of a known size
                    # rather than whatever the default is.
                    image_aspect_ratio: "square",
                    image_size: 200,

                    # No offline access: we never act on the user's behalf in the
                    # background, so we have no reason to hold a refresh token. Not
                    # requesting one is the strongest protection against leaking one.
                    access_type: "online",

                    # Do not let the strategy raise the raw provider response into a
                    # 500 page.
                    provider_ignores_state: false,
                  }
end

# OmniAuth 2.x removed GET from the request phase to close CVE-2015-9284 (login CSRF).
# The request phase must be a POST carrying a valid authenticity token, which
# omniauth-rails_csrf_protection verifies.
#
# This is why the login button is a real <form method="post">: that is simultaneously a
# full-page navigation (required, because the OAuth redirect leaves our origin and so
# must escape Inertia's XHR context) and a POST with a CSRF token (required by
# OmniAuth). `window.location = ...` satisfies only the first and would 404 here.
#
# Do NOT "fix" a 404 by adding :get to this list; that reintroduces the vulnerability.
OmniAuth.config.allowed_request_methods = [ :post ]
OmniAuth.config.silence_get_warning = true

# Provider errors must never reach the user as a stack trace. Devise routes failures to
# Users::OmniauthCallbacksController#failure, which reports a structured event and
# redirects with a generic message.
OmniAuth.config.logger = Rails.logger
