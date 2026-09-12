# frozen_string_literal: true

module Users
  # Handles the Google OAuth2 callback.
  #
  #   Google -> OmniAuth -> Devise -> User -> Rails.event -> Solid Queue
  #
  # The controller's only job is to resolve an identity into a session and emit an
  # event. Everything secondary (analytics, welcome email) happens in a worker.
  class OmniauthCallbacksController < Devise::OmniauthCallbacksController
    # This is the OAuth callback: there is no session yet, and the CSRF protection that
    # matters here is OmniAuth's own state parameter, verified by the strategy before
    # this action runs.
    skip_before_action :authenticate_user!, raise: false

    def google_oauth2
      auth = request.env["omniauth.auth"]
      return failure if auth.blank?

      user = User.from_google(auth)

      if user.persisted?
        sign_in(user)

        Rails.event.notify(
          Events::Names::OAUTH_SUCCESS,
          user_id: user.id,
          provider: auth.provider,
          request_id: request.request_id
        )

        Rails.event.notify(
          Events::Names::USER_AUTHENTICATED,
          user_id: user.id,
          provider: auth.provider,
          request_id: request.request_id
        )

        # A plain redirect, not an Inertia response: the browser arrives here from
        # Google as a top-level navigation, so there is no Inertia context to preserve.
        redirect_to dashboard_path
      else
        report_failure("record_invalid", user.errors.full_messages.first)
        redirect_to login_path
      end
    rescue StandardError => e
      # Never let a provider payload change produce a 500 with a stack trace on a
      # public, unauthenticated endpoint.
      Rails.error.report(e, handled: true)
      report_failure(e.class.name)
      redirect_to login_path
    end

    # Devise routes every provider-side failure here (user denied consent, invalid
    # state, network error, misconfigured credentials).
    def failure
      report_failure(failed_strategy_message)
      redirect_to login_path
    end

    private

    def failed_strategy_message
      # `failure_message` is an OmniAuth-provided reason code such as
      # "access_denied" or "csrf_detected". It is safe to log but is not shown verbatim.
      failure_message.presence || "unknown"
    end

    def report_failure(reason, detail = nil)
      Rails.event.notify(
        Events::Names::OAUTH_FAILURE,
        provider: "google_oauth2",
        reason: reason,
        detail: detail,
        request_id: request.request_id
      )

      # Deliberately generic. A precise reason would tell an attacker probing the
      # endpoint whether an account exists or how the provider is configured.
      flash[:alert] = "We could not sign you in with Google. Please try again."
    end
  end
end
