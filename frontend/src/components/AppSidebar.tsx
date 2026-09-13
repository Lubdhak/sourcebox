import { Link, useHttp, usePage } from '@inertiajs/react'
import { Box, LayoutDashboard, LogOut } from 'lucide-react'
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {currentUser && (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={currentUser.email} className="pointer-events-none">
                {currentUser.avatarUrl ? (
                  <img src={currentUser.avatarUrl} alt="" className="size-4 rounded-full" />
                ) : null}
                <span className="truncate">{currentUser.name}</span>
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
