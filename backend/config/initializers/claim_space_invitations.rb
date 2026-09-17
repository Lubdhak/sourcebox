# frozen_string_literal: true

# Turns invitations addressed to an email into real access, the moment their owner signs
# in.
#
# A Warden hook rather than a controller filter, because there are three ways into a
# session here -- password, Google, and the remember-me cookie -- and a filter would have
# to be right on all three. `after_set_user` is the one place all of them meet.
#
# It runs on session creation only (`:set_user`), not on every request's `:fetch`, so the
# cost is one indexed lookup per sign-in rather than per page view. An invitation sent to
# somebody already signed in therefore takes effect at their next sign-in, which is the
# price of not querying on every request; an invitation to a *new* colleague -- the case
# this exists for -- is claimed the first time they arrive.
Warden::Manager.after_set_user(scope: :user, event: :set_user) do |user, _auth, _options|
  next if user.blank?

  begin
    claimed = SpaceMembership.claim_all_for(user)

    if claimed.positive?
      Rails.event.notify(
        Events::Names::SPACE_INVITATIONS_CLAIMED,
        user_id: user.id,
        count: claimed
      )
    end
  rescue StandardError => error
    # Never let this fail a sign-in. A missed claim is recoverable at the next sign-in;
    # an exception here would lock the user out of an account they authenticated to.
    Rails.error.report(error, handled: true, context: { user_id: user.id })
  end
end
