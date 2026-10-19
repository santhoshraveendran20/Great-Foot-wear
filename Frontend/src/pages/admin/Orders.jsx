import { useEffect, useState } from "react"
import { ArrowLeft, FileText, Printer, Truck } from "lucide-react"
import { useDispatch } from "react-redux"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { DataTable, PageHeader, Pager } from "@/components/admin/ui"
import { OrderStatusBadge, PageLoader, PaymentStatusBadge, ProductImage, useDocumentTitle } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  adminSalesApi,
  useCreateAdminOrderRefundMutation,
  useGetAdminOrderQuery,
  useGetAdminOrdersQuery,
  useSaveAdminOrderShipmentMutation,
  useUpdateAdminOrderStatusMutation,
} from "@/store/api/adminSalesApi"
import { useAuth } from "@/store/auth"
import { errorMessage, openPdf } from "@/lib/api"
import { formatDate, formatINR, ORDER_STATUS, PAYMENT_STATUS } from "@/lib/utils"

export function AdminOrders() {
  useDocumentTitle("Orders")
  const navigate = useNavigate()
  const [f, setF] = useState({ q: "", status: "all", payment_method: "all", payment_status: "all", date_from: "", date_to: "" })
  const [page, setPage] = useState(1)
  const params = Object.fromEntries(Object.entries({ ...f, page }).filter(([, v]) => v !== "" && v !== "all"))
  const { data, isLoading } = useGetAdminOrdersQuery(params, { pollingInterval: 30_000, skipPollingIfUnfocused: true })
  const set = (k) => (v) => { setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v })); setPage(1) }
  return (
    <div>
      <PageHeader title="Orders" description="New orders appear here instantly with status Confirmed or Confirmed – COD" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Order no, customer name or mobile" value={f.q} onChange={set("q")} className="max-w-xs" />
        <Select value={f.status} onValueChange={set("status")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(ORDER_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={f.payment_method} onValueChange={set("payment_method")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="cod">COD</SelectItem>
          </SelectContent>
        </Select>
        <Select value={f.payment_status} onValueChange={set("payment_status")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payment status</SelectItem>
            {Object.entries(PAYMENT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={f.date_from} onChange={set("date_from")} className="w-40" aria-label="From date" />
        <Input type="date" value={f.date_to} onChange={set("date_to")} className="w-40" aria-label="To date" />
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.items}
        onRowClick={(o) => navigate(`/admin/orders/${o.id}`)}
        columns={[
          { key: "order_no", header: "Order", cell: (o) => <div><p className="font-medium">{o.order_no}</p><p className="text-xs text-muted-foreground">{formatDate(o.created_at, true)}</p></div> },
          { key: "customer", header: "Customer", cell: (o) => <div>{o.customer?.name}<p className="text-xs text-muted-foreground">{o.customer?.mobile}</p></div> },
          { key: "items", header: "Items", cell: (o) => o.item_count },
          { key: "fulfilment", header: "Type", cell: (o) => (o.fulfilment === "pickup" ? "Pickup" : "Delivery") },
          { key: "status", header: "Status", cell: (o) => <OrderStatusBadge status={o.order_status} /> },
          { key: "payment", header: "Payment", cell: (o) => <div className="space-y-1"><span className="text-xs font-medium uppercase">{o.payment_method}</span><br /><PaymentStatusBadge status={o.payment_status} /></div> },
          { key: "total", header: "Total", className: "text-right", cell: (o) => formatINR(o.total) },
        ]}
      />
      <Pager page={page} pageSize={data?.page_size || 25} total={data?.total} onPage={setPage} />
    </div>
  )
}

function ShipmentCard({ order, onSaved }) {
  const [v, setV] = useState({ courier: "", awb_no: "", tracking_url: "" })
  useEffect(() => {
    setV({ courier: order.shipment?.courier || "", awb_no: order.shipment?.awb_no || "", tracking_url: order.shipment?.tracking_url || "" })
  }, [order.shipment])
  const [saveShipment, { isLoading: saving }] = useSaveAdminOrderShipmentMutation()
  const save = () =>
    saveShipment({ id: order.id, ...v, tracking_url: v.tracking_url || null })
      .unwrap()
      .then((d) => { onSaved(d); toast.success("Shipment saved") })
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Truck className="size-4" /> Shipment</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1"><Label htmlFor="courier">Courier</Label><Input id="courier" value={v.courier} onChange={(e) => setV({ ...v, courier: e.target.value })} placeholder="e.g. Shiprocket, local courier" /></div>
        <div className="space-y-1"><Label htmlFor="awb">AWB number</Label><Input id="awb" value={v.awb_no} onChange={(e) => setV({ ...v, awb_no: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="track">Tracking link (optional)</Label><Input id="track" value={v.tracking_url} onChange={(e) => setV({ ...v, tracking_url: e.target.value })} placeholder="https://" /></div>
        <Button variant="outline" onClick={save} disabled={v.courier.length < 2 || v.awb_no.length < 2 || saving}>Save shipment</Button>
      </CardContent>
    </Card>
  )
}

// the refund mutation invalidates this order, so the page refetches it
function RefundCard({ order }) {
  const { user } = useAuth()
  const isAdmin = user.role === "admin"
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [createRefund, { isLoading: refunding }] = useCreateAdminOrderRefundMutation()
  const refund = () =>
    createRefund({ id: order.id, amount: Number(amount), reason: reason || null })
      .unwrap()
      .then(() => {
        toast.success(isAdmin ? "Refund issued" : "Refund requested. Super Admin will review it.")
        setAmount("")
        setReason("")
      })
      .catch((e) => toast.error(errorMessage(e)))
  if (!["paid", "partially_refunded", "cod_collected"].includes(order.payment_status) || Number(order.refundable_amount) <= 0) return null
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{isAdmin ? "Issue refund" : "Request refund"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Refundable: {formatINR(order.refundable_amount)}.{" "}
          {order.payment_method === "online" ? "Refunded to the original payment method via Razorpay." : "COD: transfer to the customer's bank/UPI, then mark as refunded."}
        </p>
        {order.payment_method === "cod" && (
          order.refund_details
            ? <p className="rounded bg-muted p-2 text-xs">{order.refund_details.upi_id ? `UPI: ${order.refund_details.upi_id}` : `A/c ${order.refund_details.account_number} · IFSC ${order.refund_details.ifsc} · ${order.refund_details.account_name}`}</p>
            : <p className="text-xs text-amber-700 dark:text-amber-400">Customer has not added bank/UPI details yet.</p>
        )}
        <div className="flex gap-2">
          <Input type="number" min={1} max={order.refundable_amount} step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          <Button variant="outline" size="sm" className="h-9" onClick={() => setAmount(String(order.refundable_amount))}>Full</Button>
        </div>
        <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} />
        <Button onClick={refund} disabled={!amount || Number(amount) <= 0 || refunding}>{isAdmin ? "Issue refund" : "Request refund"}</Button>
      </CardContent>
    </Card>
  )
}

export function AdminOrderDetail() {
  const { id } = useParams()
  const dispatch = useDispatch()
  // currentData is empty while a different order loads, so the loader shows instead of the previous order
  const { currentData: o, isFetching } = useGetAdminOrderQuery(id)
  const [next, setNext] = useState("")
  const [note, setNote] = useState("")
  useDocumentTitle(o ? `Order ${o.order_no}` : "Order")
  const setData = (d) => dispatch(adminSalesApi.util.upsertQueryData("getAdminOrder", id, d))
  const [updateStatus, { isLoading: changing }] = useUpdateAdminOrderStatusMutation()
  const change = () =>
    updateStatus({ id, status: next, note: note || null })
      .unwrap()
      .then((d) => {
        setData(d)
        setNext("")
        setNote("")
        toast.success("Status updated. Customer notified by email/SMS.")
      })
      .catch((e) => toast.error(errorMessage(e)))
  if (isFetching && !o) return <PageLoader />

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Order ${o.order_no}`}
        description={`Placed ${formatDate(o.created_at, true)} · ${o.fulfilment === "pickup" ? "Store pickup" : "Home delivery"}`}
        actions={
          <>
            <Button variant="ghost" asChild><Link to="/admin/orders"><ArrowLeft /> Orders</Link></Button>
            {o.invoice_no && <Button variant="outline" onClick={() => openPdf(`/admin/orders/${o.id}/invoice`).catch((e) => toast.error(errorMessage(e)))}><FileText /> Invoice</Button>}
            {o.fulfilment === "delivery" && <Button variant="outline" onClick={() => openPdf(`/admin/orders/${o.id}/label`)}><Printer /> Shipping label</Button>}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Items</CardTitle>
              <div className="flex gap-2"><OrderStatusBadge status={o.order_status} /><PaymentStatusBadge status={o.payment_status} /></div>
            </CardHeader>
            <CardContent className="space-y-4">
              {o.items.map((it) => (
                <div key={it.id} className="flex gap-3 text-sm">
                  <span className="size-14 shrink-0 overflow-hidden rounded bg-muted"><ProductImage src={it.image_url} alt="" /></span>
                  <div className="flex-1">
                    <p className="font-medium">{it.product_name}</p>
                    <p className="text-muted-foreground">SKU {it.sku} · Size {it.size} · {it.colour}</p>
                  </div>
                  <div className="text-right">
                    <p>{formatINR(it.price)} × {it.qty}</p>
                    {Number(it.discount) > 0 && <p className="text-xs text-emerald-700 dark:text-emerald-400">– {formatINR(it.discount)}</p>}
                    <p className="font-medium">{formatINR(it.line_total)}</p>
                  </div>
                </div>
              ))}
              <Separator />
              <div className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Item total</span><span>{formatINR(o.subtotal)}</span></div>
                {Number(o.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Coupon {o.coupon_code}</span><span>– {formatINR(o.discount)}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>{formatINR(o.shipping)}</span></div>
                {Number(o.cod_fee) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">COD fee</span><span>{formatINR(o.cod_fee)}</span></div>}
                <div className="flex justify-between font-semibold"><span>Total</span><span>{formatINR(o.total)}</span></div>
                <p className="text-xs text-muted-foreground">GST included {formatINR(o.tax)} ({o.is_inter_state ? "IGST" : "CGST + SGST"}){o.invoice_no ? ` · Invoice ${o.invoice_no}` : ""}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {o.history.map((h, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    <span><span className="font-medium">{ORDER_STATUS[h.status]?.label || h.status}</span>{h.note && <span className="text-muted-foreground"> — {h.note}</span>}<span className="block text-xs text-muted-foreground">{formatDate(h.created_at, true)}</span></span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {o.payments.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Payments & refunds</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {o.payments.map((p) => (
                  <div key={p.id} className="flex flex-wrap justify-between gap-2 rounded border p-2">
                    <span>{p.gateway === "cod" ? "Cash on Delivery" : `Razorpay ${p.method || ""}`} <span className="text-xs text-muted-foreground">{p.gateway_payment_id || p.gateway_order_id}</span></span>
                    <span className="flex items-center gap-2">{formatINR(p.amount)} <Badge variant="outline" className="capitalize">{p.status.replace("_", " ")}</Badge></span>
                  </div>
                ))}
                {o.refunds.map((r) => (
                  <div key={r.id} className="flex flex-wrap justify-between gap-2 rounded border border-dashed p-2">
                    <span>Refund ({r.mode}) {r.reason && <span className="text-xs text-muted-foreground">– {r.reason}</span>}</span>
                    <span className="flex items-center gap-2">{formatINR(r.amount)} <Badge variant="outline" className="capitalize">{r.status}</Badge></span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {o.allowed_next.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Update status</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Select value={next} onValueChange={setNext}>
                  <SelectTrigger><SelectValue placeholder="Choose next status" /></SelectTrigger>
                  <SelectContent>
                    {o.allowed_next.map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS[s]?.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Note to customer (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
                <Button className="w-full" variant={next === "cancelled" ? "destructive" : "default"} disabled={!next || changing} onClick={change}>
                  {next === "cancelled" ? "Cancel order" : "Update status"}
                </Button>
                {next === "cancelled" && o.payment_status === "paid" && <p className="text-xs text-muted-foreground">The prepaid amount will be refunded automatically.</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Link to={`/admin/customers/${o.customer.id}`} className="font-medium text-primary hover:underline">{o.customer.name}</Link>
              <p className="text-muted-foreground">{o.customer.mobile} · {o.customer.email}</p>
              <Separator className="my-3" />
              {o.address ? (
                <p>{o.address.name}<br />{o.address.line1}{o.address.line2 ? `, ${o.address.line2}` : ""}<br />{o.address.city}, {o.address.state} – {o.address.pincode}<br />{o.address.mobile}</p>
              ) : <p>Store pickup</p>}
            </CardContent>
          </Card>

          {o.fulfilment === "delivery" && !["cancelled", "pending_payment"].includes(o.order_status) && <ShipmentCard order={o} onSaved={setData} />}
          <RefundCard order={o} />

          {o.returns.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Returns</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {o.returns.map((r) => (
                  <div key={r.id} className="flex items-center justify-between">
                    <span className="capitalize">{r.type} – {r.item?.product_name} ({r.item?.size})</span>
                    <Badge variant="outline" className="capitalize">{r.status}</Badge>
                  </div>
                ))}
                <Button variant="link" className="h-auto p-0" asChild><Link to="/admin/returns">Manage returns</Link></Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
