# frozen_string_literal: true

# Shared building blocks for the GraphQL layer: the client-facing error taxonomy and
# the authorization helpers every field and mutation uses.
#
# Authorization lives here rather than being repeated in each resolver, so there is one
# definition of "may this user see this record" to audit and to change.
module ApplicationGraphql
  # Errors returned to clients carry a stable machine-readable `code` in `extensions`
  # and a message safe to display. They never carry an exception class, a backtrace,
  # SQL, or a record id the caller is not allowed to know about.
  class Error < GraphQL::ExecutionError
    def initialize(message, code:, extensions: {})
      super(message, extensions: { code: code }.merge(extensions))
    end
  end

  class UnauthenticatedError < Error
    def initialize(message = "You must be signed in to perform this action.")
      super(message, code: "UNAUTHENTICATED")
    end
  end

  class ForbiddenError < Error
    # Message and code are identical to a genuine "not found" on purpose -- see
    # Authorization#authorize_owner! below.
    def initialize(message = "Not found.")
      super(message, code: "NOT_FOUND")
    end
  end

  class NotFoundError < Error
    def initialize(message = "Not found.")
      super(message, code: "NOT_FOUND")
    end
  end

  class ValidationError < Error
    def initialize(message, fields: {})
      super(message, code: "VALIDATION_FAILED", extensions: { fields: fields })
    end
  end

  # Mixed into base object types and base mutations.
  module Authorization
    private

    def current_user
      context[:current_user]
    end

    def signed_in?
      current_user.present?
    end

    def require_authentication!
      raise UnauthenticatedError unless signed_in?

      current_user
    end

    # The single ownership rule for the whole schema.
    #
    # Returns the record only if the signed-in user owns it. A record owned by someone
    # else raises the *same* NOT_FOUND error as a record that does not exist, so the API
    # cannot be used to enumerate which ids are real. Distinguishing "forbidden" from
    # "missing" would leak the existence of other tenants' data.
    def authorize_owner!(record)
      require_authentication!

      raise NotFoundError if record.blank?
      raise ForbiddenError unless owned_by_current_user?(record)

      record
    end

    def owned_by_current_user?(record)
      owner_id = record.respond_to?(:user_id) ? record.user_id : record.try(:id)

      owner_id.present? && owner_id == current_user.id
    end
  end
end
