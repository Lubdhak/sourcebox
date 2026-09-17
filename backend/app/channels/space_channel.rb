# frozen_string_literal: true

# The live feed for one documentation space: who is here, where they are looking, and
# every structural change as it happens.
#
# Presence is held in memory on the clients rather than in a table, and that is a
# deliberate choice about write volume. Fifty people moving pointers around a canvas
# generate a stream of position updates that are worthless a second later; writing them
# to PostgreSQL would mean a row per cursor move plus a reaper to clean up after every
# lost connection. Instead a joiner announces itself, everyone already here answers, and
# each client ages out peers it has not heard from. Nothing to clean up, nothing to
# migrate, and a crashed tab disappears on its own.
#
# Structural changes are a different matter and are *not* published from here. They are
# published by Events::RealtimeBroadcaster, off the same Rails.event stream that already
# drives analytics, so a mutation cannot reach the database without also reaching the
# people watching it.
class SpaceChannel < ApplicationCable::Channel
  # A cursor payload is two floats and an id. Anything appreciably larger is either a bug
  # or someone using the presence channel as a free message bus.
  MAX_PRESENCE_BYTES = 2.kilobytes

  def subscribed
    space = authorized_space(params[:space_id])
    return reject if space.nil?

    @space = space
    @session_id = params[:session_id].to_s.first(64).presence || SecureRandom.uuid

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

  def cursor(data)
    broadcast_presence("presence.cursor", slice_presence(data))
  end

  private

  # Identity comes from the connection, never from the payload. The client chooses where
  # its cursor is; it does not get to choose who it is.
  def broadcast_presence(type, payload)
    return if @space.nil?

    SpaceChannel.broadcast_to(@space, {
      type: type,
      sessionId: @session_id,
      actor: {
        id: current_user.id.to_s,
        name: current_user.display_name,
        colorSeed: current_user.id,
      },
      payload: payload,
      at: Time.current.to_f,
    })
  end

  def slice_presence(data)
    presence = {
      x: float_or_nil(data["x"]),
      y: float_or_nil(data["y"]),
      focusNodeId: data["focusNodeId"].presence&.to_s,
      selectedNodeId: data["selectedNodeId"].presence&.to_s,
      editingBlockId: data["editingBlockId"].presence&.to_s,
    }.compact

    presence.to_json.bytesize > MAX_PRESENCE_BYTES ? {} : presence
  end

  def float_or_nil(value)
    Float(value)
  rescue ArgumentError, TypeError
    nil
  end
end
