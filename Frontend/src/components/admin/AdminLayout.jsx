import {
  BadgePercent,
  Boxes,
  ChartColumn,
  FileText,
  FolderTree,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Package,
  RotateCcw,
  ScrollText,
  Settings,
  ShoppingCart,
  Store,
  Tags,
  UserCog,
  Users,
  Wallet,
} from "lucide-react"
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"

import { BrandLogo, PageLoader } from "@/components/common"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuth } from "@/store/auth"

/** Menu items shown by role (section 3 / 3.3). The API enforces the same rules. */
const MENU = [
  {
    label: "Overview",
    items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true, roles: ["staff", "admin"] }],
  },
  {
    label: "Catalogue",
    items: [
      { to: "/admin/products", label: "Products", icon: Package, roles: ["staff", "admin"] },
      { to: "/admin/categories", label: "Categories", icon: FolderTree, roles: ["staff", "admin"] },
      { to: "/admin/brands", label: "Brands", icon: Tags, roles: ["staff", "admin"] },
      { to: "/admin/inventory", label: "Inventory", icon: Boxes, roles: ["staff", "admin"] },
    ],
  },
  {
    label: "Sales",
    items: [
      { to: "/admin/orders", label: "Orders", icon: ShoppingCart, roles: ["staff", "admin"] },
      { to: "/admin/returns", label: "Returns & exchanges", icon: RotateCcw, roles: ["staff", "admin"] },
      { to: "/admin/payments", label: "Payments & refunds", icon: Wallet, roles: ["admin"] },
      { to: "/admin/customers", label: "Customers", icon: Users, roles: ["staff", "admin"] },
      { to: "/admin/reviews", label: "Reviews", icon: MessageSquareText, roles: ["staff", "admin"] },
    ],
  },
  {
    label: "Marketing",
    items: [
      { to: "/admin/coupons", label: "Coupons", icon: BadgePercent, roles: ["admin"] },
      { to: "/admin/content", label: "Banners & pages", icon: FileText, roles: ["admin"] },
    ],
  },
  {
    label: "Business",
    items: [
      { to: "/admin/reports", label: "Reports", icon: ChartColumn, roles: ["admin"] },
      { to: "/admin/staff", label: "Staff users", icon: UserCog, roles: ["admin"] },
      { to: "/admin/audit-log", label: "Audit log", icon: ScrollText, roles: ["admin"] },
      { to: "/admin/settings", label: "Settings", icon: Settings, roles: ["admin"] },
    ],
  },
]

function NavItems() {
  const { user } = useAuth()
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  return MENU.map((group) => {
    const items = group.items.filter((i) => i.roles.includes(user.role))
    if (!items.length) return null
    return (
      <SidebarGroup key={group.label}>
        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((i) => {
              const active = i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)
              return (
                <SidebarMenuItem key={i.to}>
                  <SidebarMenuButton asChild isActive={active} tooltip={i.label}>
                    <NavLink to={i.to} end={i.end} onClick={() => setOpenMobile(false)}>
                      <i.icon /> <span>{i.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  })
}

export function AdminLayout() {
  const { user, ready, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  if (!ready) return <PageLoader className="min-h-screen" />
  if (!user) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (user.role === "customer") return <Navigate to="/" replace />
  if (user.must_change_password) return <Navigate to="/admin/change-password" replace />

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link to="/admin" className="flex items-center px-2 py-1.5" aria-label="Great Foot Wear admin home">
            {/* full logo when the sidebar is open, the GFW mark when it is collapsed to icons */}
            <span className="group-data-[collapsible=icon]:hidden"><BrandLogo variant="wide" className="h-7" /></span>
            <span className="hidden group-data-[collapsible=icon]:block"><BrandLogo variant="mark" className="h-3" /></span>
          </Link>
        </SidebarHeader>
        <SidebarContent><NavItems /></SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="View store">
                <a href="/" target="_blank" rel="noreferrer"><Store /> <span>View store</span></a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Logout" onClick={async () => { await logout(); navigate("/admin/login") }}>
                <LogOut /> <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ThemeToggle />
            <span className="hidden text-muted-foreground sm:inline">{user.name}</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{user.role === "admin" ? "Super Admin" : "Staff"}</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6"><Outlet /></main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function AdminOnly({ children }) {
  const { user } = useAuth()
  if (user?.role !== "admin") {
    return (
      <div className="py-20 text-center">
        <h1 className="text-xl font-semibold">Super Admin only</h1>
        <p className="mt-2 text-muted-foreground">You do not have permission to open this page.</p>
        <Button asChild className="mt-6"><Link to="/admin">Go to dashboard</Link></Button>
      </div>
    )
  }
  return children
}
