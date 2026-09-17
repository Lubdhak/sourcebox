# frozen_string_literal: true

module Types
  # Exposed as `DeletionImpact`.
  class DeletionImpactType < Types::BaseObject
    description <<~DESC
      What deleting one node would take with it, so a confirmation can name things rather
      than warn about them.
    DESC

    # Exposed as `AffectedRelationship`.
    class AffectedRelationshipType < Types::BaseObject
      description <<~DESC
        An edge that would be removed, said as a sentence: source, verb, target.

        Titles rather than ids, because the point is to be read. A count of relationships
        tells the person nothing about whether losing them matters; "Payments Gateway
        calls Order Service" tells them exactly.
      DESC

      field :id, ID, description: "The relationship id."
      field :relationship_type, String, description: "The verb, as stored: `contains`, `calls`, `depends_on`."
      field :source_title, String, description: "Title of the node the edge leaves."
      field :target_title, String, description: "Title of the node the edge arrives at."
    end

    field :node, Types::NodeType,
          description: "The node in question."

    field :descendants, [ Types::NodeType ],
          description: <<~DESC
            The nodes inside it that would cease to exist, nearest first.

            Only relevant to a cascading delete. Without `cascade` these move up into
            whatever contained the node instead.
          DESC

    field :retained, [ Types::NodeType ],
          description: <<~DESC
            Nodes inside it that also live somewhere else, and so survive either way.

            They lose this containment and keep the other. Naming them separately is the
            difference between a dialog that is accurate and one that overstates what it
            is about to do.
          DESC

    field :relationships, [ AffectedRelationshipType ],
          description: <<~DESC
            Every edge touching the node itself, named. These go whichever option is taken.

            Capped server-side for a node with an implausible number of edges; compare
            against `relationshipCount` to tell whether the list is complete.
          DESC

    field :relationship_count, Integer,
          description: "Edges touching the node itself, counting every direction."

    field :descendant_relationship_count, Integer,
          description: "Further edges that only a cascading delete would remove."

    field :block_count, Integer,
          description: "Content blocks on the node itself."

    field :descendant_block_count, Integer,
          description: "Content blocks on the nodes inside it."
  end
end
