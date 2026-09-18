import { Link, useHttp, usePage } from '@inertiajs/react'
import { cn } from 'cn'
import { Box, Keyboard, LogOut, Network } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { ROLE_LABELS } from '@/features/documentation/roles'
import type { CurrentUser, InertiaSharedProps, SpaceRole } from '@/types'

/** One binding as the rail prints it: the keys to press, and what pressing them does. */
export type Shortcut = { keys: string[]; label: string }

/**
 * The navigation rail, the keys the page answers to, and the account at the bottom.
 *
 * `role` is the viewer's standing in whatever they are currently looking at, when that
 * is a thing one can have standing in. It is passed down rather than read from shared
 * props because it is a property of the page, not of the session: the same account is
 * an owner of one space and a viewer of the next.
 */
export function AppSidebar({ role, shortcuts }: { role?: SpaceRole; shortcuts?: Shortcut[] }) {
  const page = usePage<InertiaSharedProps>()
  const { currentUser } = page.props
  const { processing, submit } = useHttp('delete', '/users/sign_out', {})
  const onSpaces = page.url.startsWith('/spaces')
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    window.localStorage.setItem('sourcebox:theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={dark ? 'Use light mode' : 'Use dark mode'}
              aria-label={dark ? 'Use light mode' : 'Use dark mode'}
              aria-pressed={dark}
              onClick={() => setDark((current) => !current)}
            >
              <Box
                className={cn(
                  'transition-[color,filter] duration-200',
                  dark && 'text-emerald-400 drop-shadow-[0_0_6px_rgba(74,222,128,0.95)]',
                )}
              />
              <span>Sourcebox</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/spaces" />}
                  isActive={onSpaces}
                  tooltip="Documentation"
                >
                  <Network />
                  <span>Documentation</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {shortcuts?.length ? <Shortcuts shortcuts={shortcuts} /> : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {currentUser && (
            <SidebarMenuItem>
              {/*
                The address under the name, not only in a tooltip. Sharing is by email
                address, so "which account am I signed in as" stopped being a detail the
                moment a space could belong to several people -- it is the answer to
                "why can I only read this".

                Collapsed, there is room for the picture and nothing else, so the rest
                moves into the card that opens on hover or focus -- the same one the
                other buttons use for their labels, holding what the row would have said
                if it had the width. It used to be `pointer-events-none`, which is why
                the rail showed a face and no way to find out whose.

                `h-auto` because the menu button is sized for one line; the taller
                variant is the exception here rather than a new component.
              */}
              <SidebarMenuButton
                tooltip={{ className: 'p-0', children: <Account user={currentUser} role={role} /> }}
                // The rail's buttons are icons in a 2rem box with 0.5rem of padding,
                // which leaves 1rem -- enough for a glyph and not for a face. The
                // picture gets the whole box.
                className="h-auto cursor-default py-1.5 group-data-[collapsible=icon]:p-1!"
              >
                <Avatar user={currentUser} />
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate">{currentUser.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {currentUser.email}
                  </span>
                  {role ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {ROLE_LABELS[role]} here
                    </span>
                  ) : null}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              disabled={processing}
              onClick={() =>
                void submit().finally(() => {
                  window.location.replace('/login')
                })
              }
            >
              <LogOut />
              <span>{processing ? 'Signing out…' : 'Sign out'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/**
 * The keys the current page answers to, written down where they can be found.
 *
 * A spatial canvas hides its keyboard by nature: nothing on screen says that Enter goes
 * into a card or that Space opens the panel beside it, and an undiscoverable shortcut is
 * one nobody presses. The rail is the only furniture every page has, so the list lives
 * here rather than behind a help dialog that is itself a thing to be found.
 *
 * Handed down by the page rather than written here, because the keys belong to what is
 * on screen -- Escape means something on a canvas and nothing on a list of spaces, and a
 * viewer who cannot rename should not be told about R. A page with no keys gets no
 * section, which is the honest thing for the rail to say about it.
 */
function Shortcuts({ shortcuts }: { shortcuts: Shortcut[] }) {
  const { state, isMobile } = useSidebar()

  // Collapsed, the rail has room for an icon, so the list moves into the card that opens
  // on hover or focus -- the same place the account details go when the row runs out of
  // width. The tooltip's own padding comes off: the list brings its own.
  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="cursor-default"
                tooltip={{
                  className: 'block p-0',
                  children: <ShortcutList shortcuts={shortcuts} onDark />,
                }}
              >
                <Keyboard />
                <span>Shortcuts</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Shortcuts</SidebarGroupLabel>
      <SidebarGroupContent>
        <ShortcutList shortcuts={shortcuts} />
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/**
 * The list itself: what it does on the left, what to press on the right, the way every
 * menu prints a shortcut. `onDark` is for the tooltip, which is foreground-coloured.
 */
function ShortcutList({ shortcuts, onDark = false }: { shortcuts: Shortcut[]; onDark?: boolean }) {
  return (
    <ul
      className={cn(
        'grid w-52 gap-1.5 px-2 py-1.5 text-[11px] leading-tight',
        onDark ? 'text-background' : 'text-sidebar-foreground/80',
      )}
    >
      {shortcuts.map((shortcut) => (
        <li key={shortcut.label} className="flex items-center justify-between gap-2">
          <span className="truncate">{shortcut.label}</span>
          <span className="flex shrink-0 gap-0.5">
            {shortcut.keys.map((key) => (
              <kbd
                key={key}
                className={cn(
                  'rounded border px-1 py-px font-sans text-[10px]',
                  onDark
                    ? 'border-background/30'
                    : 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground',
                )}
              >
                {key}
              </kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The signed-in face, or the initial standing in for one. */
function Avatar({ user }: { user: CurrentUser }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" />
  }

  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-full bg-sidebar-accent text-[11px] font-medium text-sidebar-accent-foreground"
    >
      {(user.name || user.email).trim().charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * Who is signed in, in full: the picture, the name, the address, and what this account
 * may do where it currently is.
 *
 * Shown in the tooltip of the account row, which is the only place the collapsed rail
 * has the room for it. The role reads as a sentence rather than a badge because it is
 * about the page behind the rail rather than about the account -- "Viewer" alone in a
 * chip beside an email address looks like a property of the account, which it is not.
 */
function Account({ user, role }: { user: CurrentUser; role?: SpaceRole }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-left">
      <Avatar user={user} />
      <span className="grid min-w-0 gap-0.5 leading-tight">
        <span className="truncate text-xs font-medium">{user.name}</span>
        <span className="truncate text-[11px] opacity-80">{user.email}</span>
        {role ? (
          <span className="truncate text-[11px] opacity-80">{ROLE_LABELS[role]} in this space</span>
        ) : null}
      </span>
    </div>
  )
}
