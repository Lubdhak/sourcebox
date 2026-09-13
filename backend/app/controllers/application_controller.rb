# frozen_string_literal: true

class ApplicationController < ActionController::Base
  # Rails 8 enables forgery protection by default. It is load-bearing here: the session
  # cookie is the authentication mechanism for both Inertia navigation and /graphql, so
  # CSRF protection is what stops a third-party page from acting as the user.
  #
  # `prepend: true` so this runs before Devise's `require_no_authentication`. Otherwise a
  # failed sign-in can reset session state first and then fail the token check that should
  # have been the first gate.
  protect_from_forgery with: :exception, prepend: true

  before_action :set_event_context
  before_action :authenticate_user!

  # Everything the frontend needs on every page. Shared props are serialized into the
  # initial page payload, so keep this small and never put anything secret here.
  inertia_share do
    {
      currentUser: current_user && serialize_current_user,
      flash: {
        notice: flash[:notice],
        alert: flash[:alert],
      }.compact.presence,
      # Lets the frontend logger correlate a browser-side error with the server logs
      # for the same request.
      requestId: request.request_id,
      # Native forms cannot read the XSRF-TOKEN cookie Inertia sets. They need the token
      # from this visit, not from the original document's meta tag.
      csrfToken: form_authenticity_token,
    }.compact
  end

  private

  # Establishes correlation for everything downstream of this request: Rails.event
  # attaches this context to every event, and ApplicationJob carries the request_id
  # into Solid Queue.
  def set_event_context
    Current.request_id = request.request_id
    Current.user_id = current_user&.id

    Rails.event.set_context(
      request_id: request.request_id,
      user_id: current_user&.id
    )
  end

  def serialize_current_user
    {
      id: current_user.id.to_s,
      email: current_user.email,
      name: current_user.display_name,
      avatarUrl: current_user.avatar_url,
    }
  end

  # Devise's default is a redirect to the sign-in path; point it at our Inertia login
  # page. Inertia understands a 302 to an HTML page and turns it into a visit.
  def after_sign_out_path_for(_resource)
    login_path
  end
end
