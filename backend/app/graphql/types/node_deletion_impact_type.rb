# frozen_string_literal: true

module Types
  # Exposed as `NodeDeletionImpact`.
  class NodeDeletionImpactType < Types::BaseObject
    description <<~DESC
      What a deletion would do, under one specific policy, to one specific selection.

      Requested before anything is destroyed and re-requested whenever the user changes
      an option, because the answer genuinely changes: switching the orphan policy moves
      nodes between "kept" and "deleted", and switching the reference policy decides
      whether the mentions survive. The client renders these numbers and never derives
      them, so there is exactly one implementation of what a deletion means.

      Single and bulk return the same shape. A one-node deletion is a selection of one.
    DESC

    # Exposed as `DeletionEntry`.
    class EntryType < Types::BaseObject
      description "One node in the preview, with why it is listed where it is."

      field :id, ID, description: "The node id."
      field :title, String, description: "What it is called, for reading."
      field :reason, String, null: true,
            description: "Why this node is in this group. Null for the explicit selection."
    end

    # Exposed as `DeletionReference`.
    class ReferenceType < Types::BaseObject
      description <<~DESC
        One thing pointing at one of the nodes being deleted.

        Deliberately does not distinguish an edge from an `@`-mention in its shape: the
        user's question is "what points at this", and which table it happens to live in is
        not part of that question. `kind` carries the verb for an edge and `mention` for
        prose, which is the only difference worth surfacing.
      DESC

      field :id, ID, description: "Stable identifier for this reference, for list keys."
      field :kind, String, description: "The relationship verb as stored, or `mention` for prose."
      field :source_id, ID, description: "The node doing the pointing. This one survives."
      field :source_title, String, description: "Title of the node doing the pointing."
      field :target_id, ID, description: "The node being pointed at, which is being deleted."
      field :target_title, String, description: "Title of the node being pointed at."
    end

    field :digest, String,
          description: <<~DESC
            Fingerprint of this exact preview: the policy, the nodes and the references.

            Passed back to `deleteNodes` so the mutation can refuse a selection the user
            never actually saw. If a collaborator changes the graph while the dialog is
            open, the digest stops matching and the deletion is rejected rather than
            applied to a different set.
          DESC

    field :selected, [ EntryType ],
          description: "The nodes explicitly chosen, in the order they were given."

    field :orphans, [ EntryType ],
          description: <<~DESC
            Nodes inside the selection whose only home is being removed.

            Kept and re-homed, or deleted, according to the orphan policy. Presented to
            the user as "disconnected" rather than "orphaned".
          DESC

    field :retained, [ EntryType ],
          description: "Nodes inside the selection that also live elsewhere and survive either way."

    field :references, [ ReferenceType ],
          description: <<~DESC
            Everything pointing at the nodes being deleted, edges and mentions together.

            Capped server-side; compare the length against `referenceCount` to tell whether
            the list is complete.
          DESC

    field :selected_count, Integer, description: "How many nodes were explicitly chosen."
    field :orphan_count, Integer, description: "How many nodes would be left without a home."
    field :reference_count, Integer, description: "How many pointers this deletion affects."

    field :additional_delete_count, Integer,
          description: "Nodes deleted beyond the selection itself. Zero when disconnected nodes are kept."

    field :delete_count, Integer,
          description: "Total nodes this operation would delete: the selection plus any extras."

    field :affected_count, Integer,
          description: <<~DESC
            Distinct nodes this operation touches at all.

            The ones going, plus the ones left holding a changed page. The headline number.
          DESC

    field :block_count, Integer, description: "Content blocks on the nodes being deleted."

    def delete_count
      object.deleted_ids.size
    end
  end
end
