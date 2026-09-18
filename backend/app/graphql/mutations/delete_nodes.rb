# frozen_string_literal: true

module Mutations
  # The one deletion mutation, for one node or twenty.
  #
  # Replaces `deleteNode`. There is no separate bulk path and no `cascade` boolean: the
  # three things a deletion has to decide are named arguments, and the same
  # `Documentation::NodeDeletion` service that produced the preview performs the work, so
  # the confirmation the user read and the deletion that happens cannot describe different
  # operations.
  class DeleteNodes < BaseDocumentationMutation
    description <<~DESC
      Delete one or more nodes under an explicit policy.

      Re-runs the impact calculation server-side before writing anything and compares it
      against `expectedDigest` -- the preview the user actually confirmed. A mismatch
      returns `changed: true` with the fresh impact and deletes nothing, so a collaborator
      editing the graph mid-dialog cannot turn a reviewed deletion into an unreviewed one.
    DESC

    argument :node_ids, [ ID ], description: "The nodes to delete."
    argument :deletion_mode, Types::DeletionModeEnum, required: false,
             description: "Whether the deletion is recoverable. Defaults to `SOFT`."
    argument :reference_policy, Types::ReferencePolicyEnum, required: false,
             description: "What to do with pointers at these nodes. Defaults to match the mode."
    argument :orphan_policy, Types::OrphanPolicyEnum, required: false,
             description: "What to do with the nodes filed inside these. Defaults to `KEEP`."
    argument :expected_digest, String, required: false,
             description: <<~ARG
               The `digest` from the impact the user confirmed.

               Omit it to skip the check, which is appropriate only for a caller with no
               human in the loop. Anything driving a confirmation dialog should send it.
             ARG

    field :deleted_node_ids, [ ID ], null: true,
          description: "Ids actually removed, so the client can drop them from the canvas."

    field :changed, Boolean, null: false,
          description: "True when the graph moved under the user and nothing was deleted."

    field :impact, Types::NodeDeletionImpactType, null: true,
          description: "The recalculated impact. Present when `changed` is true, so the dialog can redraw."

    def resolve(node_ids:, deletion_mode: nil, reference_policy: nil, orphan_policy: nil, expected_digest: nil)
      nodes = Array(node_ids).uniq.map { |id| authorize_within_space!(Node.find_by(id: id), :write) }

      deletion = Documentation::NodeDeletion.new(
        nodes: nodes,
        policy: Documentation::DeletionPolicy.new(
          mode: deletion_mode,
          reference_policy: reference_policy,
          orphan_policy: orphan_policy
        ),
        actor: current_user,
        request_id: context[:request_id]
      )

      deleted = deletion.call(expected_digest: expected_digest)

      { deleted_node_ids: deleted.map(&:to_s), changed: false, impact: nil }
    rescue Documentation::NodeDeletion::ImpactChanged => error
      # Not an error result: the request was well-formed and the answer is "look again".
      # Returning it as data rather than raising lets the dialog re-render the new impact
      # in place instead of showing a failure the user cannot act on.
      { deleted_node_ids: nil, changed: true, impact: error.impact }
    end
  end
end
