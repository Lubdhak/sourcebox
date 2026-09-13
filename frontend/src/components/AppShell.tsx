import type { ReactNode } from 'react'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

export function AppShell({
  children,
  header,
}: {
  children: ReactNode
  header?: ReactNode
}) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
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
