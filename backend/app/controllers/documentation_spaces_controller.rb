# frozen_string_literal: true

# Renders the documentation pages via Inertia.
#
# The division of labour is the whole design: this controller answers "which page, and
# what does it show on first paint". Every subsequent
# read and every write -- selecting a node, dragging it, editing a block, searching --
# goes to GraphQL, so the graph's business rules live in one place instead of being
# duplicated between a controller and a resolver.
#
# What it emits is a *snapshot*, in exactly the shape the GraphQL types return, via
# Documentation::WireFormat. The canvas renders from these props on first paint, from
# GraphQL thereafter, and from the realtime channel while collaborators work; all three
# must agree, so none of them owns the shape.
class DocumentationSpacesController < ApplicationController
  def index
    spaces = current_user.accessible_documentation_spaces.alphabetical
                         .preload(space_memberships: :user).to_a

    # Counted in grouped queries rather than per space, so a user with fifty spaces does
    # not produce a hundred COUNTs. The same reasoning covers access: the share control
    # on each row needs to know who is on it, and a per-row lookup would make the list
    # page scale with how widely things are shared.
    node_counts = Node.where(documentation_space: spaces).group(:documentation_space_id).count
    relationship_counts = NodeRelationship.where(documentation_space: spaces)
                                          .group(:documentation_space_id).count
    render inertia: "DocumentationSpace/Index", props: {
      spaces: spaces.map { |space|
        rows = space.space_memberships.sort_by(&:created_at)
        role = space.role_for(current_user, memberships: rows)
        administrator = SpaceMembership.allows?(role, DocumentationSpace::MINIMUM_ROLE.fetch(:admin))

        Documentation::WireFormat.space(space).merge(
          nodeCount: node_counts.fetch(space.id, 0),
          relationshipCount: relationship_counts.fetch(space.id, 0),
          viewerRole: role&.upcase,
          # A viewer is told how many people are here, which is unremarkable, but not
          # who they are: the addresses belong to the team, not to the document.
          memberCount: rows.size + 1,
          memberships: administrator ? rows.map { |row| Documentation::WireFormat.membership(row) } : [],
        )
      },
    }
  end

  def show
    space = DocumentationSpace.find_by_public_id(params[:id])

    # A space nobody shared with you is indistinguishable from one that does not exist --
    # the same rule the GraphQL layer applies, for the same reason.
    if space.nil? || !space.permits?(current_user, :read)
      return redirect_to documentation_spaces_path, alert: "That space could not be found."
    end

    # `focus` in the query string, so a drill-down is a URL: a collaborator can send
    # "look at what I am looking at" as a link, and a refresh keeps the user where they
    # were rather than throwing them back to the top of the space.
    snapshot = Documentation::GraphSnapshot.call(space: space, focus_node_id: params[:focus].presence)
    role = space.role_for(current_user)

    render inertia: "DocumentationSpace/Show", props: {
      space: Documentation::WireFormat.space(space),
      initialGraph: Documentation::WireFormat.graph(snapshot),
      # The vocabularies the editor offers. Server-owned, because the model validates
      # against the same constants, and sending them means the frontend does not keep a
      # second copy that can drift.
      relationshipTypes: NodeRelationship::SUGGESTED_TYPES,
      blockTypes: ContentBlock::TYPES.map(&:upcase),
      # Who the client is, for its own presence marker. Everyone else's identity arrives
      # over the channel, built by the same WireFormat.actor so a photo or a role is
      # never present on one and missing on the other.
      collaborator: Documentation::WireFormat.actor(current_user, role: role),
      # What this person may do here. The client uses it to decide which controls to
      # offer; it is not the enforcement -- every mutation re-derives the same answer
      # server-side, because a hidden button is a courtesy, not a boundary.
      viewerRole: role&.upcase,
    }
  end
end
