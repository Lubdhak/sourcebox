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

  # Raised when someone who *can* see a space asks to do something their role does not
  # permit -- a viewer trying to move a node, an editor trying to change who has access.
  #
  # Unlike ForbiddenError above, this one says so. Hiding it behind NOT_FOUND exists to
  # stop strangers enumerating other tenants' data, and a member is not a stranger: they
  # are looking at the space, they know it exists, and telling them "not found" would
  # only make a legible permissions rule look like a bug.
  class InsufficientRoleError < Error
    def initialize(message = "Your role in this space does not allow that.", required: nil, role: nil)
      super(message, code: "FORBIDDEN", extensions: { requiredRole: required, role: role }.compact)
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

    # The access rule for the documentation graph.
    #
    # Nodes, relationships, layers and content blocks carry no owner of their own -- a
    # space is the only thing that records access, and everything beneath it is reached
    # through that space. So `authorize_owner!` cannot be applied to them directly, and
    # every field that touches one has to arrive here first.
    #
    # Two different failures, deliberately:
    #
    #   no access at all  -> NOT_FOUND, identical to a space that does not exist. The
    #                        graph is addressed by sequential node ids, so distinguishing
    #                        the two would turn any field into an oracle for which ids
    #                        exist in other people's spaces.
    #   access, too weak  -> FORBIDDEN, and says which role would be needed. Someone who
    #                        is already in the space learns nothing from this that they
    #                        did not already know.
    #
    # `minimum` is one of DocumentationSpace::MINIMUM_ROLE's keys: :read, :write, :admin.
    def authorize_space!(space, minimum = :read)
      require_authentication!

      raise NotFoundError if space.blank?
      raise NotFoundError unless space.permits?(current_user, :read)

      unless space.permits?(current_user, minimum)
        raise InsufficientRoleError.new(
          required: DocumentationSpace::MINIMUM_ROLE.fetch(minimum),
          role: space.role_for(current_user)
        )
      end

      space
    end

    # Resolves a space from the opaque `public_id` clients use in URLs and GraphQL
    # arguments, then authorizes it.
    def authorize_space_by_public_id!(public_id, minimum = :read)
      authorize_space!(DocumentationSpace.find_by_public_id(public_id), minimum)
    end

    # Authorizes a record that belongs to a space, by loading its space and applying the
    # rule above. Returns the record, so it reads as a guard at the top of a resolver:
    #
    #   node = authorize_within_space!(Node.find_by(id: id))
    def authorize_within_space!(record, minimum = :read)
      require_authentication!

      raise NotFoundError if record.blank?

      space_id = record.documentation_space_id
      raise NotFoundError if space_id.blank?

      authorize_space!(DocumentationSpace.find_by(id: space_id), minimum)

      record
    end

    # Content blocks are two hops from their space (block -> node -> space), which is the
    # only reason this needs its own helper rather than reusing the one above.
    def authorize_content_block!(block, minimum = :read)
      require_authentication!

      raise NotFoundError if block.blank?

      authorize_within_space!(Node.find_by(id: block.node_id), minimum)

      block
    end

    # The space a record belongs to, already authorized. Reaching for
    # `record.documentation_space` after a guard would be a second, unguarded load.
    def space_of(record, minimum = :read)
      authorize_within_space!(record, minimum)

      DocumentationSpace.find(record.documentation_space_id)
    end
  end
end
