import type { ReactNode } from 'react'
import { AppSidebar, type Shortcut } from '@/components/AppSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SpaceRole } from '@/types'

/**
 * The frame every page is drawn in: a navigation rail, a header, and the page.
 *
 * The rail starts collapsed. Navigation is two destinations and an account, none of
 * which needs a word beside its icon to be found again, and the pages under it are
 * horizontal: a canvas with a panel next to it spends every pixel it is given. A
 * sixteen-rem column of mostly empty space would come out of the half of the screen
 * the documentation is read in. The trigger in the header (or ⌘B) opens it when the
 * labels are actually wanted.
 */
export function AppShell({
  children,
  header,
  role,
  shortcuts,
}: {
  children: ReactNode
  header?: ReactNode
  /** The viewer's role in whatever this page is about, for the account block. */
  role?: SpaceRole
  /** The keys this page answers to, listed in the rail. Pages without any pass none. */
  shortcuts?: Shortcut[]
}) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <AppSidebar role={role} shortcuts={shortcuts} />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            {header}
          </header>
          <div className="flex-1">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
