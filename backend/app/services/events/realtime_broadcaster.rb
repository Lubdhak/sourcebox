# frozen_string_literal: true

module Events
  # Rails.event subscriber that pushes documentation changes to everyone watching.
  #
  # This sits beside JobDispatcher on the same event stream, and the pairing is the point:
  # one subscriber sends work to a queue for later, the other sends state to browsers now.
  # Neither the operations nor the GraphQL mutations know either exists, so a new mutation
  # becomes collaborative by emitting the event it was going to emit anyway. The
  # alternative -- a `broadcast` call in every operation -- is the same code written nine
  # times, and the ninth one gets forgotten.
  #
  # Why not a job, when everything else secondary goes to a job: a Solid Queue worker
  # polls, and a poll interval is a floor on how stale a collaborator's screen is. The
  # whole feature is that the other person's change appears while they are still making
  # it. Broadcasting is one INSERT into the cable database, which is the same order of
  # cost as enqueuing, so it runs inline for the same reason enqueuing does.
  #
  # Two rules, inherited from JobDispatcher and just as load-bearing:
  #
  #   1. It only ever publishes. No rendering, no HTTP, no graph traversal.
  #   2. It never raises. Failing to tell other people about a change must not fail the
  #      change.
  class RealtimeBroadcaster
    # Node moves are here, unlike in JobDispatcher, and the asymmetry is deliberate. A
    # drag is worth nothing to analytics and is the single most important thing to mirror
    # live: it is how a collaborator sees that someone else is rearranging the canvas
    # underneath them. The events are already batched per drag by
    # Documentation::MoveNodes, so this is one message per gesture, not per frame.
    HANDLED = [
      Names::DOCUMENTATION_NODE_CREATED,
      Names::DOCUMENTATION_NODE_UPDATED,
      Names::DOCUMENTATION_NODE_MOVED,
      Names::DOCUMENTATION_NODE_DELETED,
      Names::DOCUMENTATION_NODE_REPARENTED,
      Names::DOCUMENTATION_NODE_CLONED,
      Names::DOCUMENTATION_LAYER_CHANGED,
      Names::DOCUMENTATION_RELATIONSHIP_CREATED,
      Names::DOCUMENTATION_RELATIONSHIP_DELETED,
      Names::DOCUMENTATION_BLOCK_UPDATED,
      Names::DOCUMENTATION_BLOCK_DELETED,
      Names::DOCUMENTATION_LAYER_CREATED,
      Names::DOCUMENTATION_LAYER_UPDATED,
      Names::DOCUMENTATION_LAYER_DELETED,
    ].to_set.freeze

    def self.filter
      ->(event) { HANDLED.include?(event[:name]) }
    end

    def emit(event)
      payload = event[:payload] || {}
      space = DocumentationSpace.find_by(id: payload[:space_id])
      return if space.nil?

      message = build(event[:name], payload, space)
      return if message.nil?

      SpaceChannel.broadcast_to(space, message.merge(
        type: event[:name],
        # The originator's own client has already applied this optimistically. Echoing the
        # actor lets it recognise its own change and skip re-applying it, which is what
        # stops a node the user is dragging from being yanked back by its own round trip.
        actorId: payload[:actor_id]&.to_s
      ))
    rescue StandardError => e
      Rails.error.report(e, handled: true, context: { event_name: event[:name] })
    end

    private

    # Each message carries the changed records in wire format, not just their ids. Sending
    # ids would make every collaborator refetch on every keystroke-adjacent change: fifty
    # people editing one space would turn one person's drag into fifty graph queries.
    def build(name, payload, space)
      case name
      when Names::DOCUMENTATION_NODE_CREATED, Names::DOCUMENTATION_NODE_UPDATED, Names::DOCUMENTATION_LAYER_CHANGED
        node = space.nodes.find_by(id: payload[:node_id])
        node && { node: Documentation::WireFormat.node(node, child_count: child_count(node)) }

      when Names::DOCUMENTATION_NODE_MOVED
        nodes = space.nodes.where(id: Array(payload[:node_ids]))
        { nodes: nodes.map { |node| Documentation::WireFormat.node(node, child_count: child_count(node)) } }

      when Names::DOCUMENTATION_NODE_DELETED
        # Every id, not just the one the user clicked: a cascading delete removes a whole
        # subtree, and a client told only about the root would leave the rest on screen
        # until something else made it refetch.
        { nodeId: payload[:node_id].to_s, nodeIds: Array(payload[:node_ids]).map(&:to_s) }

      when Names::DOCUMENTATION_NODE_REPARENTED, Names::DOCUMENTATION_NODE_CLONED
        # Which level a node belongs on is a question only the server can answer, so this
        # carries the fact and no records: the client refetches the level it is looking at.
        { nodeId: payload[:node_id].to_s }

      when Names::DOCUMENTATION_RELATIONSHIP_CREATED
        edge = space.node_relationships.find_by(id: payload[:relationship_id])
        edge && { relationship: Documentation::WireFormat.relationship(edge) }

      when Names::DOCUMENTATION_RELATIONSHIP_DELETED
        { relationshipId: payload[:relationship_id].to_s }

      when Names::DOCUMENTATION_BLOCK_UPDATED, Names::DOCUMENTATION_BLOCK_DELETED
        # Only the fact, not the content: whoever has that node open refetches it, and
        # whoever is editing it is already synchronised through the CRDT channel.
        { nodeId: payload[:node_id].to_s, blockId: payload[:block_id]&.to_s }

      when Names::DOCUMENTATION_LAYER_CREATED, Names::DOCUMENTATION_LAYER_UPDATED, Names::DOCUMENTATION_LAYER_DELETED
        { layers: Documentation::WireFormat.layers(space.reload) }
      end
    end

    def child_count(node)
      Documentation::WireFormat.child_counts([ node.id ]).fetch(node.id, 0)
    end
  end
end
