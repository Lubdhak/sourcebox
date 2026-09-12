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
