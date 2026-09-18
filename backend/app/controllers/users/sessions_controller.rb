# frozen_string_literal: true

module Users
  # Replaces Devise's own sessions controller so /users/sign_in renders the Inertia login
  # page instead of Devise's scaffolded ERB view.
  #
  # Devise's shipped view is unusable here: it renders shared/_links, which calls
  # `new_user_registration_path`. Registrations are disabled (`skip: [:registrations]`), so
  # that helper does not exist and the view raises NoMethodError. Rather than vendoring and
  # editing Devise's ERB, the page is an Inertia component like every other page in the app.
  #
  # `create` is inherited; `auth_options` below changes only how a failed sign-in is
  # answered (redirect instead of recalling #new on the same POST). `destroy` is unchanged.
  class SessionsController < Devise::SessionsController
    # ApplicationController requires a session for every action. This is the page you visit
    # to get one.
    skip_before_action :authenticate_user!, raise: false

    def new
      render inertia: "Auth/Login", props: {
        # The OAuth request phase. A POST, so the page renders a real form.
        googleAuthPath: user_google_oauth2_omniauth_authorize_path,

        # Whether to show the email/password form.
        #
        # Enable this in production and locally. The environment variable remains an
        # explicit override for other environments, while Google OAuth stays available.
        allowPasswordSignIn: Rails.env.production? || Rails.env.development? ||
          ActiveModel::Type::Boolean.new.cast(ENV.fetch("EMAIL_PASS_LOGIN", false)),

        # Set by Devise's failure app on a bad sign-in, and by the OAuth callback controller
        # on a provider error. Generic by design: `Devise.paranoid = true` keeps this from
        # becoming an account-enumeration oracle.
        error: flash[:alert],
      }
    end

    private

    # Devise's default `recall: "users/sessions#new"` re-runs `#new` on the same POST
    # after a failed sign-in. Rails 8 verifies CSRF again on that inner request, after
    # the session token has already been rotated, which raises InvalidAuthenticityToken
    # instead of showing "Invalid email or password." Omitting `recall` makes FailureApp
    # redirect (303) to #new, which is a GET with a fresh token and the flash intact.
    def auth_options
      { scope: resource_name, locale: I18n.locale }
    end
  end
end
