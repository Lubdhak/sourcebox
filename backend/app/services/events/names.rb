# frozen_string_literal: true

module Events
  # The canonical event vocabulary.
  #
  # Event names are an API: dashboards, alerts and log queries are built on them,
  # so they must not drift. Referencing constants instead of inline strings means a
  # typo is a NameError at boot rather than a silently missing metric.
  module Names
    USER_AUTHENTICATED = "user.authenticated"
    USER_CREATED       = "user.created"

    DASHBOARD_UPDATED  = "dashboard.updated"

    # The documentation graph's mutation vocabulary.
    #
    # Every structural change to a space passes through exactly one of these, which is
    # what makes versioning possible later without event sourcing now: the sequence of
    # events already describes how a space reached its current shape, so a future
    # revisions table can be populated from them rather than from a rewrite of the
    # mutation layer.
    DOCUMENTATION_SPACE_CREATED   = "documentation.space_created"
    DOCUMENTATION_NODE_CREATED    = "documentation.node_created"
    DOCUMENTATION_NODE_UPDATED    = "documentation.node_updated"
    DOCUMENTATION_NODE_MOVED      = "documentation.node_moved"
    DOCUMENTATION_NODE_DELETED    = "documentation.node_deleted"
    # Moving a node between parents and copying one are structural changes in their own
    # right, not a pair of edge writes and not a create: "this was filed somewhere else"
    # and "this is a copy of that" are the facts a later revision history would want, and
    # they are unrecoverable from the edge events alone.
    DOCUMENTATION_NODE_REPARENTED = "documentation.node_reparented"
    DOCUMENTATION_NODE_CLONED     = "documentation.node_cloned"
    DOCUMENTATION_LAYER_CHANGED   = "documentation.layer_changed"
    DOCUMENTATION_LAYER_CREATED   = "documentation.layer_created"
    DOCUMENTATION_LAYER_UPDATED   = "documentation.layer_updated"
    DOCUMENTATION_LAYER_DELETED   = "documentation.layer_deleted"
    DOCUMENTATION_RELATIONSHIP_CREATED = "documentation.relationship_created"
    DOCUMENTATION_RELATIONSHIP_DELETED = "documentation.relationship_deleted"
    DOCUMENTATION_BLOCK_UPDATED   = "documentation.content_block_updated"
    DOCUMENTATION_BLOCK_DELETED   = "documentation.content_block_deleted"

    # Who may see a space, and who decided so. Separate from the graph vocabulary above
    # because these describe changes to *access*, which is the thing you most want to be
    # able to reconstruct after the fact.
    SPACE_SHARED              = "documentation.space_shared"
    SPACE_ROLE_CHANGED        = "documentation.space_role_changed"
    SPACE_ACCESS_REVOKED      = "documentation.space_access_revoked"
    SPACE_INVITATIONS_CLAIMED = "documentation.space_invitations_claimed"


    GRAPHQL_REQUEST    = "graphql.request"
    GRAPHQL_MUTATION   = "graphql.mutation"
    GRAPHQL_ERROR      = "graphql.error"

    OAUTH_SUCCESS      = "oauth.success"
    OAUTH_FAILURE      = "oauth.failure"

    JOB_ENQUEUED       = "job.enqueued"
    JOB_COMPLETED      = "job.completed"
    JOB_FAILED         = "job.failed"

    ALL = constants.map { |c| const_get(c) }.freeze
  end
end
