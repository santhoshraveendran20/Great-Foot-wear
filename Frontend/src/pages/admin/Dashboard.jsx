import { useState } from "react"
import { AlertTriangle, IndianRupee, PackageCheck, RotateCcw, ShoppingCart, UserPlus } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Link, useNavigate } from "react-router-dom"

import { DashboardDetailsSheet } from "@/components/admin/DashboardDetailsSheet"
import { DataTable, PageHeader, StatCard } from "@/components/admin/ui"
import { OrderStatusBadge, PageLoader, useDocumentTitle } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDate, formatINR } from "@/lib/utils"
import { useGetAdminDashboardQuery } from "@/store/api/adminCatalogApi"

export default function Dashboard() {
  useDocumentTitle("Dashboard")
  const navigate = useNavigate()
  const [period, setPeriod] = useState("today")
  const [details, setDetails] = useState(null) // which card's side panel is open
  const { data, isLoading } = useGetAdminDashboardQuery(undefined, { pollingInterval: 60_000, skipPollingIfUnfocused: true })
  if (isLoading) return <PageLoader />
  const s = data.stats[period]
  const metric = data.full ? "sales" : "orders"
  const chartConfig = { [metric]: { label: data.full ? "Sales (₹)" : "Orders", color: "hsl(var(--chart-1))" } }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={data.full ? "Sales, orders and stock at a glance" : "Orders and stock at a glance"}
        actions={
          <Tabs value={period} onValueChange={setPeriod}>
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">7 days</TabsTrigger>
              <TabsTrigger value="month">30 days</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.full && <StatCard title="Sales" value={formatINR(s.sales)} hint={`Avg. order ${formatINR(s.avg_order_value)}`} icon={IndianRupee} onClick={() => setDetails("sales")} />}
        <StatCard title="Orders" value={s.orders} icon={ShoppingCart} onClick={() => setDetails("orders")} />
        <StatCard title="New customers" value={s.new_customers} icon={UserPlus} onClick={() => setDetails("customers")} />
        <StatCard title="Pending orders" value={data.pending_orders} hint="Confirmed / packed – to ship" icon={PackageCheck} onClick={() => setDetails("pending")} />
        {!data.full && <StatCard title="Open returns" value={data.open_returns} icon={RotateCcw} onClick={() => setDetails("returns")} />}
      </div>
      <DashboardDetailsSheet metric={details} period={period} onClose={() => setDetails(null)} />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{data.full ? "Sales" : "Orders"} – last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={data.chart.map((d) => ({ ...d, sales: Number(d.sales ?? 0) }))}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(d) => d.slice(8)} interval={2} />
                <YAxis tickLine={false} axisLine={false} width={50} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(d) => formatDate(d)} />} />
                <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-500" /> Low stock</CardTitle>
            <CardDescription>{data.low_stock_count} SKUs at or below threshold</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.low_stock.length === 0 && <p className="text-sm text-muted-foreground">All good.</p>}
            {data.low_stock.slice(0, 8).map((v) => (
              <div key={v.variant_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{v.product_name} <span className="text-muted-foreground">({v.size}/{v.colour})</span></span>
                <Badge variant={v.stock_qty === 0 ? "destructive" : "warning"}>{v.stock_qty}</Badge>
              </div>
            ))}
            {data.low_stock_count > 0 && <Link to="/admin/inventory?low_stock=1" className="block pt-2 text-sm text-primary hover:underline">View all</Link>}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle className="text-base">Recent orders</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              rows={data.recent_orders}
              onRowClick={(o) => navigate(`/admin/orders/${o.id}`)}
              columns={[
                { key: "order_no", header: "Order" },
                { key: "customer", header: "Customer", cell: (o) => o.customer?.name },
                { key: "status", header: "Status", cell: (o) => <OrderStatusBadge status={o.order_status} /> },
                { key: "payment", header: "Payment", cell: (o) => o.payment_method.toUpperCase() },
                { key: "total", header: "Total", className: "text-right", cell: (o) => formatINR(o.total) },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top 10 products (30 days)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.top_products.length === 0 && <p className="text-sm text-muted-foreground">No sales yet.</p>}
            {data.top_products.map((p, i) => (
              <div key={`${p.product_id}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate"><span className="text-muted-foreground">{i + 1}.</span> {p.name}</span>
                <span className="shrink-0 text-muted-foreground">{p.qty} sold{data.full ? ` · ${formatINR(p.revenue)}` : ""}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
