# frozen_string_literal: true

module Mutations
  # Base class for every mutation that changes a documentation graph.
  #
  # It carries no behaviour of its own any more, and that is the point: authorization is
  # one call to the helpers in ApplicationGraphql::Authorization, made at the top of each
  # resolver, with the role the mutation requires passed in.
  #
  #   node = authorize_within_space!(Node.find_by(id: node_id), :write)
  #   ... perform the operation ...
  #
  # It used to hold the rule that turned a contributor's write into a proposal for review.
  # That role and its review queue are gone: a space now has readers, editors and admins,
  # and an edit either happens or is refused. Mutations therefore have one outcome instead
  # of two, which removes a nullable field from every payload and a branch from every
  # client that consumed one.
  #
  # The class is kept as the place that says so, and as the seam for the next rule that
  # genuinely belongs to all of them.
  class BaseDocumentationMutation < BaseMutation
  end
end
