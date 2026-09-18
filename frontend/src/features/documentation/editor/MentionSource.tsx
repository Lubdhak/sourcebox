import { createContext, useContext, useMemo } from 'react'
import { getMentionOnSelectItem } from '@platejs/mention'
import type { PlateEditor } from 'platejs/react'
import type { MentionCandidate } from '@/features/documentation/editor/MentionPicker'

/**
 * Where the mention picker gets its nodes, and what happens when one is chosen.
 *
 * Through context rather than through props because the thing that needs it is a node
 * renderer: Plate draws the `@` being typed wherever it appears in the document, and a
 * renderer has no way to be handed the page's props. The page provides them once, around
 * the editor, and every mention input in it can see them.
 */

export interface MentionSource {
  /** Shown before anything is typed: the nodes on screen, which is usually enough. */
  candidates: MentionCandidate[]
  onSearchMentions: (query: string) => Promise<MentionCandidate[]>
  /** Replaces the typed query with a chip. */
  onSelect: (editor: PlateEditor, candidate: MentionCandidate, query: string) => void
}

const EMPTY: MentionSource = {
  candidates: [],
  onSearchMentions: async () => [],
  onSelect: () => {},
}

const MentionSourceContext = createContext<MentionSource>(EMPTY)

export function useMentionSource(): MentionSource {
  return useContext(MentionSourceContext)
}

export function MentionSourceProvider({
  candidates,
  onSearchMentions,
  children,
}: {
  candidates: MentionCandidate[]
  onSearchMentions: (query: string) => Promise<MentionCandidate[]>
  children: React.ReactNode
}) {
  const value = useMemo<MentionSource>(
    () => ({
      candidates,
      onSearchMentions,
      // The node id is the mention's identity and its title is only what is shown, which
      // is why both are stored: the link has to keep pointing at the same node after
      // somebody renames it.
      onSelect: (editor, candidate, query) =>
        insertMention(editor, { key: candidate.id, text: candidate.title }, query),
    }),
    [candidates, onSearchMentions],
  )

  return <MentionSourceContext value={value}>{children}</MentionSourceContext>
}

const insertMention = getMentionOnSelectItem<{ key: string; text: string }>()
