/**
 * A stable colour per collaborator.
 *
 * Derived from the user's id rather than assigned on arrival, so the same person is the
 * same colour in every session, on every client, without anyone having to allocate or
 * release colours. Two people can collide on a palette this size; the alternative is
 * coordinating assignment across fifty clients to avoid a cosmetic clash, which is not a
 * trade worth making.
 *
 * Chosen for contrast against both themes and for distinguishability from each other,
 * including for the most common forms of colour blindness -- the cursor label carries
 * the name as well, so colour is never the only signal.
 */
const PALETTE = [
  '#2563eb', // blue
  '#db2777', // pink
  '#16a34a', // green
  '#ea580c', // orange
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#ca8a04', // amber
  '#dc2626', // red
] as const

export function collaboratorColor(seed: number): string {
  const index = Math.abs(Math.trunc(seed)) % PALETTE.length

  return PALETTE[index] ?? PALETTE[0]
}
