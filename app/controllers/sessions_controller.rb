# frozen_string_literal: true

# Renders the login page as an Inertia component.
#
# Deliberately does not inherit Devise's SessionsController: there is no password form
# to POST here. Google is the only identity provider, and its request phase is handled
# by Devise's OmniAuth routes.
class SessionsController < ApplicationController
  skip_before_action :authenticate_user!, only: [ :new ]

  def new
    return redirect_to dashboard_path if user_signed_in?

    render inertia: "Auth/Login", props: {
      # The request phase is a POST, so the page needs a CSRF token to submit.
      googleAuthPath: user_google_oauth2_omniauth_authorize_path,
      # Surfaced from the OAuth failure redirect. Always a generic message.
      error: flash[:alert],
    }
  end
end
