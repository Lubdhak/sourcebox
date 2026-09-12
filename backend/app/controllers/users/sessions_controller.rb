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
  # `create` and `destroy` are inherited unchanged: Warden already handles authentication and
  # Devise already handles the redirects.
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
        # Development only, and deliberately so. Google OAuth needs real client credentials,
        # which a fresh checkout does not have, so without this there is no way to sign in
        # locally at all. In production Google is the only path in, and rendering a password
        # form there would invite credential-stuffing against accounts that were created
        # through OAuth and have a random password.
        allowPasswordSignIn: Rails.env.development?,

        # Set by Devise's failure app on a bad sign-in, and by the OAuth callback controller
        # on a provider error. Generic by design: `Devise.paranoid = true` keeps this from
        # becoming an account-enumeration oracle.
        error: flash[:alert],
      }
    end
  end
end
