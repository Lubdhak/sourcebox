# frozen_string_literal: true

# Character-level collaborative editing of one node's documentation.
#
# The server is a relay and a log, not a merger. Clients exchange CRDT updates; this
# channel authorizes them, records them so a late joiner can catch up, and fans them out.
# It never inspects a payload, which is why two people typing into the same sentence
# converge without Rails knowing what a sentence is.
#
# Separate from SpaceChannel because the traffic is completely different in shape. A
# space's feed is a handful of structural messages that everyone in the space needs; this
# is a dense stream of small updates that only the people with this node open care about.
# Putting them together would push every keystroke in a space to everyone in it.
class NodeDocumentChannel < ApplicationCable::Channel
  def subscribed
    # Editors only. A reader has nothing to contribute to a shared text, and a CRDT
    # update is merged into the shared state the moment it arrives -- there is no point
    # in this protocol at which an unwelcome change could be held back.
    node = authorized_node(params[:node_id], :write)
    return reject if node.nil?

    # Cached alongside the document rather than re-derived per awareness message: it is a
    # fact about this subscription, not about any one broadcast.
    @role = node.documentation_space.role_for(current_user)
    @document = CrdtDocument.for_node(node)

    stream_for @document

    # The joiner gets the state directly rather than through the stream: it is addressed
    # to them, and broadcasting a full document to everyone whenever somebody opens a
    # node would make an editing session quadratic in the number of editors.
    transmit_sync
  end

  # Tells everyone else this session's face should come off their roster.
  #
  # Best effort, the same as SpaceChannel's: a tab that is killed rather than closed
  # never gets here, and there is no reaper on this side to age the entry out once it is
  # stale. Accepted for the reason that comment gives too -- catching every case would
  # mean a heartbeat for a presence signal nothing here currently sends one for, and the
  # common case (closing the panel, navigating away, a normal tab close) already reaches
  # this every time.
  def unsubscribed
    return if @document.nil?

    NodeDocumentChannel.broadcast_to(@document, { type: "left", sessionId: session_id })
  end

  # A CRDT update from one client, on its way to all the others.
  #
  # Recorded before it is relayed. A client that receives an update the server has not
  # stored would have state nobody else can reconstruct after a refresh, which is the
  # one inconsistency this design cannot repair by itself.
  def update(data)
    return if @document.nil?

    payload = decode(data["update"])
    return if payload.blank?

    record = @document.append(payload, actor_id: current_user.id)

    NodeDocumentChannel.broadcast_to(@document, {
      type: "update",
      update: data["update"],
      seq: record.id,
      # Senders filter their own echo by session rather than by user: the same person with
      # the node open in two tabs is two editors, and each has to see the other.
      sessionId: session_id,
      actorId: current_user.id.to_s,
    })

  rescue ActiveRecord::RecordInvalid => e
    # An oversized or malformed update is the sender's problem and must not take the
    # channel down for everyone else on it.
    transmit({ type: "rejected", reason: e.record.errors.full_messages.first })
  end

  # Whether this session has the page open, and whether it is typing. Relayed, never
  # stored: it describes a moment, not a fact worth having tomorrow, and every client
  # reconstructs its own copy from this stream rather than asking for one.
  def awareness(data)
    return if @document.nil?

    NodeDocumentChannel.broadcast_to(@document, {
      type: "awareness",
      state: data["state"],
      sessionId: session_id,
      actor: Documentation::WireFormat.actor(current_user, role: @role),
    })
  end

  # A Yjs Awareness update: encoded bytes naming a selection inside the text, one caret or
  # highlight at a time. Opaque here in exactly the way a CRDT `update` is -- this method
  # exists to authorize and relay, not to decode -- and never recorded, for the reason
  # `awareness` above already gives about anything describing a single moment.
  def cursor(data)
    return if @document.nil?

    payload = decode(data["update"])
    return if payload.blank?

    NodeDocumentChannel.broadcast_to(@document, {
      type: "cursor",
      update: data["update"],
      sessionId: session_id,
    })
  end

  # A client offers a merged snapshot of everything up to `throughSeq`, so the log can be
  # truncated. The server validates the sequence and takes it on faith otherwise -- it
  # cannot check a merge it cannot perform. The exposure is bounded by the same
  # authorization as editing: anyone who can compact this document can already rewrite it
  # by typing into it.
  def compact(data)
    return if @document.nil?
    # A broadcast watermark is not proof of receipt: streams can be missed or reordered.
    # Only a complete, directly transmitted sync authorizes truncation at this sequence.
    unless @checkpoint_seq && data["throughSeq"].to_i == @checkpoint_seq
      return transmit({ type: "rejected", reason: "Compaction requires a complete sync checkpoint." })
    end

    state = decode(data["state"])
    return if state.blank?

    @document.compact!(state, data["throughSeq"])
  end

  def sync(data)
    return if @document.nil?

    after_seq = data["afterSeq"]
    if after_seq && after_seq.to_i != @sync_seq
      return transmit({ type: "rejected", reason: "Sync cursor does not match the previous page." })
    end

    transmit_sync(after_seq: after_seq&.to_i)
  end

  private

  def transmit_sync(after_seq: nil)
    payload = @document.sync_payload(
      after_seq: after_seq,
      limit: params[:sync_pages] ? CrdtDocument::SYNC_BATCH_SIZE : nil
    )
    @sync_seq = payload[:seq]
    @checkpoint_seq = payload[:syncComplete] ? payload[:seq] : nil
    transmit({ type: "sync" }.merge(payload))
  end

  def session_id
    params[:session_id].to_s.first(64)
  end

  def decode(encoded)
    return nil if encoded.blank?

    Base64.strict_decode64(encoded.to_s)
  rescue ArgumentError
    nil
  end
end
