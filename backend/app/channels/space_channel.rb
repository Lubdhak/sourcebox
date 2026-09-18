# frozen_string_literal: true

# The live feed for one documentation space: who is here, what node they are looking at,
# and every structural change as it happens.
#
# Presence is held in memory on the clients rather than in a table, and that is a
# deliberate choice about write volume. Fifty people moving through a canvas generate a
# stream of focus and selection updates that are worthless a second later; writing them
# to PostgreSQL would mean a row per move plus a reaper to clean up after every lost
# connection. Instead a joiner announces itself, everyone already here answers, and each
# client ages out peers it has not heard from. Nothing to clean up, nothing to migrate,
# and a crashed tab disappears on its own.
#
# Deliberately silent on where anyone's pointer is. An earlier version of this channel
# also relayed literal mouse coordinates, translated into graph space and drawn as a
# floating name tag that followed the cursor across open canvas -- which put a label on
# blank space with nothing to say about it, and did so at the highest-frequency traffic
# this channel carried. Presence now surfaces only where there is something to attach it
# to: a node's card, and the inspector open on it.
#
# Structural changes are a different matter and are *not* published from here. They are
# published by Events::RealtimeBroadcaster, off the same Rails.event stream that already
# drives analytics, so a mutation cannot reach the database without also reaching the
# people watching it.
class SpaceChannel < ApplicationCable::Channel
  # A presence payload is a couple of ids. Anything appreciably larger is either a bug or
  # someone using the presence channel as a free message bus.
  MAX_PRESENCE_BYTES = 2.kilobytes

  def subscribed
    space = authorized_space(params[:space_id])
    return reject if space.nil?

    @space = space
    @session_id = params[:session_id].to_s.first(64).presence || SecureRandom.uuid
    # Computed once per subscription rather than per broadcast: it does not change while
    # the subscription is open, and re-deriving it on every heartbeat's worth of presence
    # traffic would be a query for something already known.
    @role = space.role_for(current_user)

    stream_for space
  end

  def unsubscribed
    return if @space.nil?

    # Best effort: a tab that is killed rather than closed never gets here, which is why
    # clients also age out peers they have stopped hearing from.
    broadcast_presence("presence.left", {})
  end

  # Announce arrival, or answer someone else's announcement.
  #
  # Both directions are the same message, which is what makes a late joiner's roster fill
  # in without any server-side state: the newcomer says hello, everyone replies, and both
  # sides end up knowing about each other.
  def hello(data)
    broadcast_presence("presence.here", slice_presence(data))
  end

  # Every subsequent presence change: a selection, a focus move, the periodic heartbeat
  # that doubles as this session's liveness signal. One action for all of them, since the
  # client is reporting the same kind of fact -- "here is my current presence" -- whether
  # something changed a moment ago or nothing has and this is just proof of life.
  def presence(data)
    broadcast_presence("presence.update", slice_presence(data))
  end

  private

  # Identity comes from the connection, never from the payload. The client chooses what
  # it is looking at; it does not get to choose who it is.
  def broadcast_presence(type, payload)
    return if @space.nil?

    SpaceChannel.broadcast_to(@space, {
      type: type,
      sessionId: @session_id,
      actor: Documentation::WireFormat.actor(current_user, role: @role),
      payload: payload,
      at: Time.current.to_f,
    })
  end

  def slice_presence(data)
    presence = {
      focusNodeId: data["focusNodeId"].presence&.to_s,
      selectedNodeId: data["selectedNodeId"].presence&.to_s,
      editingBlockId: data["editingBlockId"].presence&.to_s,
    }.compact

    presence.to_json.bytesize > MAX_PRESENCE_BYTES ? {} : presence
  end
end
