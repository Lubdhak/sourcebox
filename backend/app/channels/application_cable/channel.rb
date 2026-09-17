# frozen_string_literal: true

module ApplicationCable
  # Shared authorization for every channel.
  #
  # The rule is the same one the GraphQL layer applies in ApplicationGraphql::Authorization
  # -- a space is the only thing that records ownership, and everything beneath it is
  # reached by traversing to that space -- and it has to be repeated here because a
  # subscription never passes through a GraphQL resolver.
  #
  # That repetition is the risk this file exists to contain. A channel that forgets to
  # authorize does not merely leak one record: it subscribes an attacker to a live feed of
  # someone else's edits. So there is exactly one way in, `authorized_space`, and it
  # rejects rather than raises, because a rejected subscription is what the client is
  # built to handle.
  class Channel < ActionCable::Channel::Base
    private

    # `minimum` is a DocumentationSpace::MINIMUM_ROLE key. Reading a live feed needs
    # only :read -- a viewer watching a document change is the point of sharing it --
    # while a channel that accepts writes asks for more.
    def authorized_space(public_id, minimum = :read)
      space = DocumentationSpace.find_by_public_id(public_id)

      return nil if space.nil? || !space.permits?(current_user, minimum)

      space
    end

    def authorized_node(node_id, minimum = :read)
      node = Node.find_by(id: node_id)
      return nil if node.nil?

      return nil if authorized_space_record(node.documentation_space_id, minimum).nil?

      node
    end

    def authorized_space_record(space_id, minimum = :read)
      space = DocumentationSpace.find_by(id: space_id)
      return nil if space.nil? || !space.permits?(current_user, minimum)

      space
    end
  end
end
