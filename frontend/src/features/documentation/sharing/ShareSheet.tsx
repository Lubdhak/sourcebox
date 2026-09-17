import { Loader2, Mail, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import * as api from '@/features/documentation/graphql'
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/features/documentation/roles'
import { GraphQLRequestError } from '@/lib/graphql'
import type { SpaceMembership, SpaceRole } from '@/types'

/**
 * Who can get into a space, and what they may do once they are in.
 *
 * Sharing is by email address and never by account, which is the one decision this
 * panel is built around: the person sharing knows an address, and whether that address
 * has signed up yet is the app's problem rather than theirs. An invitation to a stranger
 * sits here marked "invited" until they sign in, at which point it silently becomes
 * ordinary access.
 *
 * The role is chosen at the same moment as the address rather than afterwards, because
 * "add them, then decide what they can do" is two decisions where the sharer only made
 * one -- and the gap between them is a window where somebody has the wrong access.
 */
export function ShareSheet({
  spaceId,
  spaceName,
  open,
  initialMemberships,
  onOpenChange,
  onMembershipsChange,
}: {
  spaceId: string
  spaceName: string
  open: boolean
  initialMemberships: SpaceMembership[]
  onOpenChange: (open: boolean) => void
  onMembershipsChange?: (memberships: SpaceMembership[]) => void
}) {
  const [memberships, setMemberships] = useState<SpaceMembership[]>(initialMemberships)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<SpaceRole>('VIEWER')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const commit = (next: SpaceMembership[]) => {
    setMemberships(next)
    onMembershipsChange?.(next)
  }

  const run = async (work: () => Promise<SpaceMembership[]>) => {
    setBusy(true)
    setError(null)

    try {
      commit(await work())
    } catch (err: unknown) {
      if (err instanceof GraphQLRequestError && err.isUnauthenticated) {
        window.location.replace('/login')
        return
      }

      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const invite = (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim()) return

    void run(async () => {
      const next = await api.shareSpace({ spaceId, email: email.trim(), role })
      setEmail('')
      return next
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Share “{spaceName}”</SheetTitle>
          <SheetDescription>
            Invite by email. People who do not have an account yet get access the first time they
            sign in.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={invite} className="space-y-2 border-b border-border p-4">
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="colleague@example.com"
              aria-label="Email address to invite"
              className="min-w-0 flex-1"
              required
            />
            <RoleSelect value={role} onChange={setRole} label="Role for the new member" />
          </div>

          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>

          <Button type="submit" size="sm" disabled={busy || !email.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
            Add person
          </Button>
        </form>

        {error ? (
          <p role="alert" className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          <li className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">You</span>
              <span className="block truncate text-xs text-muted-foreground">Created this space</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABELS.OWNER}</span>
          </li>

          {memberships.map((membership) => (
            <li key={membership.id} className="flex items-center gap-2 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm">{membership.name}</span>
                  {membership.pending ? (
                    <span
                      title="Waiting for them to sign in"
                      className="inline-flex shrink-0 items-center gap-1 rounded-xs bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                    >
                      <Mail className="size-2.5" aria-hidden />
                      Invited
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{membership.email}</span>
              </span>

              <RoleSelect
                value={membership.role}
                label={`Role for ${membership.name}`}
                onChange={(next) =>
                  void run(async () => {
                    const updated = await api.changeMemberRole({ membershipId: membership.id, role: next })
                    return memberships.map((row) => (row.id === updated.id ? updated : row))
                  })
                }
              />

              <button
                type="button"
                aria-label={`Remove ${membership.name}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.revokeSpaceAccess(membership.id)
                    return memberships.filter((row) => row.id !== membership.id)
                  })
                }
                className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>

        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Contributors’ edits arrive as suggestions. An admin approves each one before it becomes
          part of the documentation.
        </p>
      </SheetContent>
    </Sheet>
  )
}

function RoleSelect({
  value,
  label,
  onChange,
}: {
  value: SpaceRole
  label: string
  onChange: (role: SpaceRole) => void
}) {
  return (
    <label className="shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SpaceRole)}
        title={ROLE_DESCRIPTIONS[value]}
        className="h-8 rounded-sm border border-input bg-transparent px-1.5 text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      >
        {ASSIGNABLE_ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  )
}
