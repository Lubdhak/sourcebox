# frozen_string_literal: true

module ApplicationCable
  # Identifies the user behind a WebSocket.
  #
  # A socket is long-lived and, unlike a request, is never re-authenticated: whoever this
  # method decides the connection belongs to is who every message on it is attributed to,
  # for as long as it stays open. So an unidentified connection is rejected outright
  # rather than treated as anonymous -- there is nothing in this application a signed-out
  # visitor should be subscribing to.
  #
  # The session cookie is read directly instead of going through Warden. Warden is
  # available in `env` only while Action Cable runs inside the Rails process, and reading
  # the cookie works either way, which keeps the option of moving cable to its own
  # process from turning into an authentication rewrite.
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = find_verified_user
    end

    private

    def find_verified_user
      user_id = warden_user_id
      user = user_id && User.find_by(id: user_id)

      # `reject_unauthorized_connection` closes the socket with a 404-equivalent rather
      # than telling the client why, matching how the GraphQL layer refuses to
      # distinguish "missing" from "forbidden".
      reject_unauthorized_connection if user.nil?

      user
    end

    # Devise stores `[[user_id], salt_fragment]` under "warden.user.user.key" in the
    # session. Only the id is used here; the salt is Devise's own check that the session
    # predates a password change, and the cookie having decrypted at all already proves
    # the session was issued by this application.
    def warden_user_id
      session = cookies.encrypted[Rails.application.config.session_options[:key] || "_sourcebox_session"]
      return nil if session.blank?

      Array(session["warden.user.user.key"]).first&.first
    rescue StandardError
      # A malformed or undecryptable cookie is an unauthenticated connection, not a 500.
      nil
    end
  end
end
