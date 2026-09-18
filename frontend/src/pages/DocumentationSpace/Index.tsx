import { Head, Link, router } from '@inertiajs/react'
import { Network, Plus, Share2, Users } from 'lucide-react'
import { useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createSpace } from '@/features/documentation/graphql'
import { canAdminister, ROLE_LABELS } from '@/features/documentation/roles'
import { ShareSheet } from '@/features/documentation/sharing/ShareSheet'
import { GraphQLRequestError } from '@/lib/graphql'
import type { DocumentationSpace, DocumentationSpaceIndexPageProps, SpaceMembership } from '@/types'

/**
 * The list of documentation spaces.
 *
 * Reading is an Inertia page and creating is a GraphQL mutation, which is the split the
 * whole app makes: navigation and first paint belong to Inertia, and a fine-grained
 * write that should not push a history entry belongs to GraphQL. The visit after a
 * successful create is deliberate -- the user asked to make a space, so taking them into
 * it is the expected outcome.
 */
export default function DocumentationSpaceIndex({ spaces }: DocumentationSpaceIndexPageProps) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Which row's share panel is open, and the membership list as it stands after any
  // edits made in it. Held here rather than in the sheet so that closing and reopening
  // does not show the stale list the page was rendered with.
  const [sharing, setSharing] = useState<string | null>(null)
  const [edited, setEdited] = useState<Record<string, SpaceMembership[]>>({})

  const membershipsFor = (space: DocumentationSpace) => edited[space.id] ?? space.memberships ?? []

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    setCreating(true)
    setError(null)

    try {
      const space = await createSpace({ name: name.trim() })
      router.visit(`/spaces/${space.id}`)
    } catch (err: unknown) {
      if (err instanceof GraphQLRequestError && err.isUnauthenticated) {
        window.location.replace('/login')
        return
      }

      setError(err instanceof Error ? err.message : 'Could not create the space.')
      setCreating(false)
    }
  }

  return (
    <AppShell header={<span className="text-sm font-medium">Documentation</span>}>
      <Head title="Documentation" />

      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="font-heading text-xl font-medium">Documentation spaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each space is one graph: nodes for the things you document, relationships for how they
            connect, and a canvas you navigate spatially.
          </p>
        </div>

        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New space name"
            aria-label="New space name"
            className="max-w-xs"
          />
          <Button type="submit" disabled={creating || !name.trim()}>
            <Plus className="size-4" />
            {creating ? 'Creating…' : 'Create space'}
          </Button>
        </form>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {spaces.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No spaces yet. Create one above, or run <code className="font-mono">./dev seed</code> for a
            worked example.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {spaces.map((space) => {
              const memberships = membershipsFor(space)
              const shareable = canAdminister(space.viewerRole)
              // Owner plus everyone in the list. The server sends a count for people who
              // cannot see the list itself, so both cases have a number to show.
              const people = shareable ? memberships.length + 1 : (space.memberCount ?? 1)

              return (
                <li key={space.id} className="flex items-center gap-1 pr-2 hover:bg-accent">
                  <Link
                    href={`/spaces/${space.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <Network className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{space.name}</span>
                      {space.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {space.description}
                        </span>
                      ) : null}
                    </span>

                    {/*
                      The role is shown only when it is not the obvious one. Labelling
                      every space you own "Owner" is noise; being reminded that this is
                      one you can only read is the thing worth knowing before you open it.
                    */}
                    {space.viewerRole && space.viewerRole !== 'OWNER' ? (
                      <span className="shrink-0 rounded-xs bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {ROLE_LABELS[space.viewerRole]}
                      </span>
                    ) : null}

                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {space.nodeCount ?? 0} nodes · {space.relationshipCount ?? 0} edges
                    </span>
                  </Link>

                  {people > 1 ? (
                    <span
                      title={`${people} people have access`}
                      className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                    >
                      <Users className="size-3" aria-hidden />
                      {people}
                    </span>
                  ) : null}

                  {shareable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSharing(space.id)}
                      aria-label={`Share ${space.name}`}
                    >
                      <Share2 className="size-3.5" />
                      <span className="hidden sm:inline">Share</span>
                    </Button>
                  ) : null}

                  <ShareSheet
                    spaceId={space.id}
                    spaceName={space.name}
                    open={sharing === space.id}
                    initialMemberships={memberships}
                    onOpenChange={(open) => setSharing(open ? space.id : null)}
                    onMembershipsChange={(next) =>
                      setEdited((current) => ({ ...current, [space.id]: next }))
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
