/**
 * Collapses several sessions belonging to the same signed-in person into one.
 *
 * Presence is tracked per browser tab, not per person -- see `SESSION_ID` in
 * `@/lib/cable` -- because a cursor genuinely is a per-tab fact: the same person with a
 * space open twice has two pointers on screen, and each has to see the other. But a
 * roster is not a cursor. "Who is here", "who is reading this node" and "who else has
 * this page open" are questions about people, and a person who answers from two tabs at
 * once is still one answer, not two -- so every list built for reading rather than for
 * drawing a pointer runs through this first.
 *
 * Keyed on `actor.id`, which is the one thing every session belonging to the same person
 * carries identically. Where callers track recency (`lastSeen`), the most recently active
 * session wins the merge; where they do not (a text editor's awareness roster has no such
 * field), any one of them will do, since the identity fields -- name, photo, role -- are
 * the same on all of a person's sessions regardless of which one is picked.
 */
export function dedupeByActor<T extends { actor: { id: string }; lastSeen?: number }>(entries: T[]): T[] {
  const byActor = new Map<string, T>()

  for (const entry of entries) {
    const current = byActor.get(entry.actor.id)
    if (!current || (entry.lastSeen ?? 0) >= (current.lastSeen ?? 0)) {
      byActor.set(entry.actor.id, entry)
    }
  }

  return [...byActor.values()]
}
