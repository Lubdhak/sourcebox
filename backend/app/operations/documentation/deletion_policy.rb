# frozen_string_literal: true

module Documentation
  # The three independent questions a deletion has to answer.
  #
  # They are separate axes because they have separate consequences and users get them
  # wrong in different ways. Whether the node comes back (mode), whether the sentences
  # that pointed at it keep pointing (references), and whether the things filed under it
  # die with it (orphans) are not the same decision, and collapsing them into a single
  # "cascade: true/false" boolean -- which is what this replaces -- meant the answer to
  # all three was whichever one the caller happened to be thinking about.
  #
  # A value object rather than three loose keyword arguments so that the impact
  # calculation and the execution cannot disagree about what was asked for: they take the
  # same object, and it is the thing that gets fingerprinted into the digest.
  class DeletionPolicy
    # Recoverable. The row stays, `deleted_at` is set, every read path stops returning it.
    MODE_SOFT = "soft"
    # Gone. The row and its blocks are destroyed and the edges go with them.
    MODE_HARD = "hard"
    MODES = [ MODE_SOFT, MODE_HARD ].freeze

    # Leave the pointers alone. Correct for a soft delete, because the node can come back
    # and a reference that was rewritten cannot be un-rewritten.
    REFERENCES_PRESERVE = "preserve"
    # Drop the edges and flatten the prose mentions to plain text, so nothing is left
    # pointing at something that no longer exists.
    REFERENCES_REMOVE = "remove"
    REFERENCE_POLICIES = [ REFERENCES_PRESERVE, REFERENCES_REMOVE ].freeze

    # The things inside survive, re-homed into whatever contained the node being deleted.
    ORPHANS_KEEP = "keep"
    # The things inside go too.
    ORPHANS_DELETE = "delete"
    ORPHAN_POLICIES = [ ORPHANS_KEEP, ORPHANS_DELETE ].freeze

    attr_reader :mode, :reference_policy, :orphan_policy

    # Defaults are the conservative corner of the matrix: recoverable, nothing rewritten,
    # nothing extra destroyed. A caller that wants something destructive has to say so.
    def initialize(mode: MODE_SOFT, reference_policy: nil, orphan_policy: ORPHANS_KEEP)
      @mode = normalize(mode, MODES, MODE_SOFT)
      @orphan_policy = normalize(orphan_policy, ORPHAN_POLICIES, ORPHANS_KEEP)

      # Derived when unspecified, because the honest default differs by mode: preserving
      # references to a row that no longer exists would leave links to nothing, and
      # rewriting references to a row that is coming back would lose them for good.
      @reference_policy = normalize(
        reference_policy,
        REFERENCE_POLICIES,
        hard? ? REFERENCES_REMOVE : REFERENCES_PRESERVE
      )
    end

    def soft?
      mode == MODE_SOFT
    end

    def hard?
      mode == MODE_HARD
    end

    def preserve_references?
      reference_policy == REFERENCES_PRESERVE
    end

    def remove_references?
      reference_policy == REFERENCES_REMOVE
    end

    def keep_orphans?
      orphan_policy == ORPHANS_KEEP
    end

    def delete_orphans?
      orphan_policy == ORPHANS_DELETE
    end

    def to_h
      { mode: mode, reference_policy: reference_policy, orphan_policy: orphan_policy }
    end

    # Part of the digest, so a policy change between preview and execute is a conflict
    # rather than a silent substitution.
    def fingerprint
      [ mode, reference_policy, orphan_policy ].join(":")
    end

    private

    # Unknown values fall back rather than raise. The enum is enforced at the GraphQL
    # boundary, so anything arriving here out of range is a programming error on our own
    # side, and defaulting to the safe option beats a 500 on a delete dialog.
    def normalize(value, permitted, fallback)
      candidate = value.to_s.downcase.presence

      permitted.include?(candidate) ? candidate : fallback
    end
  end
end
