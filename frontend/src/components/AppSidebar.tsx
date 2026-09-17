import { Link, useHttp, usePage } from '@inertiajs/react'
import { Box, LayoutDashboard, LogOut, Network } from 'lucide-react'
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
} from '@/components/ui/sidebar'
import type { InertiaSharedProps } from '@/types'

export function AppSidebar() {
  const page = usePage<InertiaSharedProps>()
  const { currentUser } = page.props
  const { processing, submit } = useHttp('delete', '/users/sign_out', {})
  const onDashboard = page.url.startsWith('/dashboard')
  const onSpaces = page.url.startsWith('/spaces')

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/dashboard" />} tooltip="Sourcebox">
              <Box />
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
                  render={<Link href="/dashboard" />}
                  isActive={onDashboard}
                  tooltip="Dashboard"
                >
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
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

                `h-auto` because the menu button is sized for one line; the taller
                two-line variant is the exception here rather than a new component.
              */}
              <SidebarMenuButton
                tooltip={currentUser.email}
                className="pointer-events-none h-auto py-1.5"
              >
                {currentUser.avatarUrl ? (
                  <img src={currentUser.avatarUrl} alt="" className="size-6 shrink-0 rounded-full" />
                ) : null}
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate">{currentUser.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {currentUser.email}
                  </span>
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
