import { ChevronRight, Loader2, Mail, Phone } from "lucide-react"
import { Link } from "react-router-dom"

import { OrderStatusBadge } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatDate, formatINR } from "@/lib/utils"
import { useGetAdminDashboardDetailsQuery } from "@/store/api/adminCatalogApi"

const PERIOD_LABEL = { today: "today", week: "in the last 7 days", month: "in the last 30 days" }
const TITLES = {
  customers: "New customers",
  orders: "Orders",
  sales: "Sales",
  pending: "Pending orders",
  returns: "Open returns",
}

function describe(metric, period, total) {
  const when = PERIOD_LABEL[period]
  if (metric === "customers") return `${total} customer${total === 1 ? "" : "s"} joined ${when}`
  if (metric === "pending") return `${total} order${total === 1 ? "" : "s"} confirmed or packed, waiting to ship`
  if (metric === "returns") return `${total} return request${total === 1 ? "" : "s"} waiting for a decision`
  return `${total} order${total === 1 ? "" : "s"} placed ${when} (cancelled and unpaid orders are not counted)`
}

function CustomerRow({ c, onOpen }) {
  return (
    <li className="space-y-2 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">{c.name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{c.name}</p>
          <p className="text-xs text-muted-foreground">Joined {formatDate(c.created_at, true)}</p>
        </div>
        <Badge variant={c.is_active ? "success" : "destructive"}>{c.is_active ? "Active" : "Blocked"}</Badge>
      </div>
      <div className="space-y-1 text-sm">
        {c.mobile && (
          <p className="flex items-center gap-2">
            <Phone className="size-3.5 text-muted-foreground" /> <a href={`tel:+91${c.mobile}`} className="hover:underline">{c.mobile}</a>
            <Badge variant={c.mobile_verified ? "success" : "warning"} className="ml-auto">{c.mobile_verified ? "Verified" : "Not verified"}</Badge>
          </p>
        )}
        <p className="flex items-center gap-2">
          <Mail className="size-3.5 text-muted-foreground" /> <a href={`mailto:${c.email}`} className="truncate hover:underline">{c.email}</a>
          <Badge variant={c.email_verified ? "success" : "warning"} className="ml-auto shrink-0">{c.email_verified ? "Verified" : "Not verified"}</Badge>
        </p>
      </div>
      <div className="flex items-center justify-between border-t pt-2 text-sm">
        <span className="text-muted-foreground">{c.orders} order{c.orders === 1 ? "" : "s"} · {formatINR(c.spent)} spent</span>
        <Button variant="link" size="sm" className="h-auto p-0" asChild>
          <Link to={`/admin/customers/${c.id}`} onClick={onOpen}>Full profile <ChevronRight /></Link>
        </Button>
      </div>
    </li>
  )
}

function OrderRow({ o, onOpen }) {
  return (
    <li>
      <Link to={`/admin/orders/${o.id}`} onClick={onOpen} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{o.order_no}</span>
            <OrderStatusBadge status={o.order_status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {o.customer?.name || "—"} · {o.item_count} item{o.item_count === 1 ? "" : "s"} · {o.payment_method?.toUpperCase()}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(o.created_at, true)}</p>
        </div>
        {o.total !== undefined && <span className="shrink-0 font-semibold">{formatINR(o.total)}</span>}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

/** Off-canvas panel listing the records behind a dashboard card. */
export function DashboardDetailsSheet({ metric, period, onClose }) {
  const open = Boolean(metric)
  const { currentData: data, isFetching, isError } = useGetAdminDashboardDetailsQuery({ metric, period }, { skip: !open })
  const isCustomers = metric === "customers"
  const sum = !isCustomers && data?.items?.some((o) => o.total !== undefined)
    ? data.items.reduce((s, o) => s + Number(o.total || 0), 0)
    : null
  const listLink = isCustomers ? "/admin/customers" : metric === "returns" ? "/admin/returns" : "/admin/orders"

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-6 text-left">
          <SheetTitle>{TITLES[metric] || ""}</SheetTitle>
          <SheetDescription>{data ? describe(metric, period, data.total) : "Loading…"}</SheetDescription>
          {sum !== null && metric === "sales" && <p className="pt-1 text-2xl font-bold">{formatINR(sum)}</p>}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {isFetching && !data && <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
          {isError && <p className="text-sm text-destructive">Could not load the details. Please try again.</p>}
          {data && data.items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing to show for this period.</p>}
          {data && data.items.length > 0 && (
            <ul className="space-y-3">
              {data.items.map((it) => (isCustomers ? <CustomerRow key={it.id} c={it} onOpen={onClose} /> : <OrderRow key={it.id} o={it} onOpen={onClose} />))}
            </ul>
          )}
          {data && data.total > data.items.length && (
            <p className="pt-3 text-center text-xs text-muted-foreground">Showing the latest {data.items.length} of {data.total}.</p>
          )}
        </div>
        <div className="border-t p-4">
          <Button variant="outline" className="w-full" asChild>
            <Link to={listLink} onClick={onClose}>Open the full {isCustomers ? "customers" : metric === "returns" ? "returns" : "orders"} list</Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
