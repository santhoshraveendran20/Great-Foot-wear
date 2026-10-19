import { useState } from "react"
import { Check, Download, ExternalLink, Loader2, Package, RotateCcw, XCircle } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { EmptyState, OrderStatusBadge, PageLoader, PaymentStatusBadge, ProductImage, useDocumentTitle } from "@/components/common"
import { useRetryPayment } from "@/pages/store/OrderResult"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { downloadFile, errorMessage } from "@/lib/api"
import { cn, formatDate, formatINR, ORDER_STATUS } from "@/lib/utils"
import {
  useCancelMyOrderMutation,
  useGetMyOrdersQuery,
  useGetOrderExchangeOptionsQuery,
  useRequestOrderReturnMutation,
  useSaveOrderRefundDetailsMutation,
} from "@/store/api/accountApi"
import { useGetOrderQuery } from "@/store/api/commonApi"

export function MyOrders() {
  useDocumentTitle("My orders")
  const { data = [], isLoading } = useGetMyOrdersQuery()
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-2xl font-bold">My orders</h1>
      {!data.length ? (
        <EmptyState icon={Package} title="No orders yet" action={<Button asChild><Link to="/">Start shopping</Link></Button>} />
      ) : (
        data.map((o) => (
          <Link key={o.id} to={`/account/orders/${o.id}`} className="block">
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-4">
                <span className="size-16 shrink-0 overflow-hidden rounded bg-muted"><ProductImage src={o.first_item?.image_url} alt="" /></span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.order_no}</span>
                    <OrderStatusBadge status={o.order_status} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {o.first_item?.name}{o.item_count > 1 ? ` + ${o.item_count - 1} more` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(o.created_at)} · {formatINR(o.total)}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))
      )}
    </div>
  )
}

const FLOW = ["confirmed", "packed", "shipped", "out_for_delivery", "delivered"]

/** OR-01 status timeline */
function Timeline({ order }) {
  if (["cancelled", "pending_payment"].includes(order.order_status) || order.fulfilment === "pickup") {
    return (
      <ol className="space-y-3">
        {order.history.map((h, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            <span>
              <span className="font-medium">{ORDER_STATUS[h.status]?.label || h.status}</span>
              {h.note && <span className="text-muted-foreground"> — {h.note}</span>}
              <span className="block text-xs text-muted-foreground">{formatDate(h.created_at, true)}</span>
            </span>
          </li>
        ))}
      </ol>
    )
  }
  const reachedAt = (s) => order.history.find((h) => h.status === s)?.created_at
  const currentIdx = FLOW.indexOf(order.order_status)
  const done = (i) => (currentIdx === -1 ? !!reachedAt(FLOW[i]) : i <= currentIdx)
  return (
    <div className="space-y-4">
      <ol className="grid grid-cols-5 gap-1">
        {FLOW.map((s, i) => (
          <li key={s} className="flex flex-col items-center gap-2 text-center">
            <span className={cn("grid size-7 place-items-center rounded-full border-2 text-xs", done(i) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30 text-muted-foreground")}>
              {done(i) ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("text-[11px] leading-tight sm:text-xs", done(i) ? "font-medium" : "text-muted-foreground")}>{ORDER_STATUS[s].label}</span>
            {reachedAt(s) && <span className="hidden text-[10px] text-muted-foreground sm:block">{formatDate(reachedAt(s))}</span>}
          </li>
        ))}
      </ol>
      {["return_requested", "returned", "refunded"].includes(order.order_status) && (
        <p className="text-sm">Current status: <OrderStatusBadge status={order.order_status} /></p>
      )}
    </div>
  )
}

function CancelDialog({ order, open, onOpenChange }) {
  const [reason, setReason] = useState("")
  // invalidates the order and the orders list
  const [cancelOrder, { isLoading: cancelling }] = useCancelMyOrderMutation()
  const cancel = () =>
    cancelOrder({ id: order.id, reason })
      .unwrap()
      .then(() => {
        toast.success(order.payment_status === "paid" ? "Order cancelled. Your refund has been initiated." : "Order cancelled")
        onOpenChange(false)
      })
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel order {order.order_no}?</DialogTitle>
          <DialogDescription>{order.payment_status === "paid" ? "The amount you paid will be refunded to your original payment method." : "You can cancel before the order is shipped."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason">Reason</Label>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell us why you are cancelling" maxLength={255} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep order</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || cancelling} onClick={cancel}>Cancel order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** OR-04 return / size exchange with reason + photo */
function ReturnDialog({ order, item, onOpenChange }) {
  const [type, setType] = useState("exchange")
  const [reason, setReason] = useState("")
  const [photo, setPhoto] = useState(null)
  const [exchangeId, setExchangeId] = useState("")
  const [busy, setBusy] = useState(false)
  const { data: options = [] } = useGetOrderExchangeOptionsQuery({ orderId: order.id, itemId: item?.id }, { skip: !item })
  const [requestReturn] = useRequestOrderReturnMutation()
  if (!item) return null
  const submit = async () => {
    const fd = new FormData()
    fd.append("order_item_id", item.id)
    fd.append("type", type)
    fd.append("reason", reason)
    fd.append("qty", 1)
    if (type === "exchange") fd.append("exchange_variant_id", exchangeId)
    fd.append("photo", photo)
    setBusy(true)
    try {
      await requestReturn({ id: order.id, data: fd }).unwrap()
      toast.success("Request submitted. We'll update you soon.")
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const valid = reason.trim().length >= 3 && photo && (type === "return" || exchangeId)
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Return or exchange</DialogTitle>
          <DialogDescription>{item.product_name} · Size {item.size} · {item.colour}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={type} onValueChange={setType} className="grid grid-cols-2 gap-3">
            {[["exchange", "Size exchange"], ["return", "Return for refund"]].map(([v, l]) => (
              <Label key={v} htmlFor={`rt-${v}`} className={cn("flex cursor-pointer items-center gap-2 rounded-md border p-3 font-normal", type === v && "border-primary bg-primary/5")}>
                <RadioGroupItem value={v} id={`rt-${v}`} /> {l}
              </Label>
            ))}
          </RadioGroup>
          {type === "exchange" && (
            <div className="space-y-2">
              <Label>New size</Label>
              {options.length ? (
                <Select value={exchangeId} onValueChange={setExchangeId}>
                  <SelectTrigger><SelectValue placeholder="Choose a size" /></SelectTrigger>
                  <SelectContent>{options.map((o) => <SelectItem key={o.id} value={String(o.id)}>Size {o.size} · {o.colour}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">No other sizes are in stock right now. You can request a return instead.</p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="ret-reason">Reason</Label>
            <Textarea id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="E.g. size too small" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ret-photo">Photo of the product</Label>
            <Input id="ret-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!valid || busy} onClick={submit}>{busy && <Loader2 className="animate-spin" />} Submit request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** PY-08: bank / UPI details for COD refunds */
function RefundDetails({ order }) {
  const [v, setV] = useState({ upi_id: "", account_name: "", account_number: "", ifsc: "" })
  const [saveDetails, { isLoading: saving }] = useSaveOrderRefundDetailsMutation()
  const save = () => {
    const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null]))
    saveDetails({ id: order.id, ...body })
      .unwrap()
      .then(() => toast.success("Refund details saved"))
      .catch((e) => toast.error(errorMessage(e)))
  }
  const f = (k, label, props = {}) => (
    <div className="space-y-1">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} value={v[k]} onChange={(e) => setV({ ...v, [k]: k === "ifsc" ? e.target.value.toUpperCase() : e.target.value })} {...props} />
    </div>
  )
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Refund details (Cash on Delivery)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Enter a UPI ID, or your bank account details, so we can send your refund.</p>
        {f("upi_id", "UPI ID", { placeholder: "name@bank" })}
        <Separator />
        <div className="grid gap-3 sm:grid-cols-3">
          {f("account_name", "Account holder name")}
          {f("account_number", "Account number", { inputMode: "numeric" })}
          {f("ifsc", "IFSC", { maxLength: 11 })}
        </div>
        <Button onClick={save} disabled={saving}>Save details</Button>
      </CardContent>
    </Card>
  )
}

export function MyOrderDetail() {
  const { id } = useParams()
  const { data: o, isLoading } = useGetOrderQuery(id)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [returnItem, setReturnItem] = useState(null)
  const { retry, busy } = useRetryPayment(id)
  useDocumentTitle(o ? `Order ${o.order_no}` : "Order")
  if (isLoading) return <PageLoader />
  if (!o) return <EmptyState icon={XCircle} title="Order not found" />
  const returnedQty = (itemId) => o.returns.filter((r) => r.order_item_id === itemId && r.status !== "rejected").reduce((s, r) => s + r.qty, 0)
  const needsRefundDetails = o.payment_method === "cod" && (o.returns.some((r) => r.type === "return" && r.status !== "rejected") || o.refunds.length > 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold">Order {o.order_no}</h1>
          <p className="text-sm text-muted-foreground">Placed on {formatDate(o.created_at, true)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.invoice_no && (
            <Button variant="outline" onClick={() => downloadFile(`/orders/${o.id}/invoice`, `${o.invoice_no}.pdf`).catch((e) => toast.error(errorMessage(e)))}>
              <Download /> Invoice
            </Button>
          )}
          {o.can_retry_payment && <Button onClick={retry} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Pay now</Button>}
          {o.can_cancel && <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
        </div>
      </div>

      {o.order_status === "pending_payment" && (
        <Alert><AlertDescription>Payment pending. Complete the payment to confirm this order.</AlertDescription></Alert>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Status</CardTitle>
          <div className="flex gap-2"><OrderStatusBadge status={o.order_status} /><PaymentStatusBadge status={o.payment_status} /></div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Timeline order={o} />
          {o.shipment?.awb_no && (
            <div className="rounded-md bg-muted p-3 text-sm">
              Shipped via <strong>{o.shipment.courier}</strong> · AWB <strong>{o.shipment.awb_no}</strong>
              {o.shipment.tracking_url && (
                <a href={o.shipment.tracking_url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">Track <ExternalLink className="size-3" /></a>
              )}
            </div>
          )}
          {o.cancel_reason && <p className="text-sm text-muted-foreground">Cancellation reason: {o.cancel_reason}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {o.items.map((it) => (
            <div key={it.id} className="flex gap-4 py-3 first:pt-0 last:pb-0">
              <span className="size-16 shrink-0 overflow-hidden rounded bg-muted"><ProductImage src={it.image_url} alt="" /></span>
              <div className="flex-1 text-sm">
                <p className="font-medium">{it.product_name}</p>
                <p className="text-muted-foreground">Size {it.size} · {it.colour} · Qty {it.qty}</p>
                <p>{formatINR(it.line_total)}</p>
              </div>
              {o.can_return && returnedQty(it.id) < it.qty && (
                <Button variant="outline" size="sm" onClick={() => setReturnItem(it)}><RotateCcw /> Return / exchange</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {o.returns.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Returns & exchanges</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {o.returns.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <span>{r.type === "exchange" ? `Exchange to size ${r.exchange_variant?.size}` : "Return"} – {r.item?.product_name} ({r.item?.size})</span>
                <span className="flex items-center gap-2">
                  <Badge variant={r.status === "rejected" ? "destructive" : r.status === "completed" ? "success" : "warning"} className="capitalize">{r.status}</Badge>
                  {r.admin_note && <span className="text-muted-foreground">{r.admin_note}</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {needsRefundDetails && !["refunded"].includes(o.payment_status) && <RefundDetails order={o} />}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{o.fulfilment === "pickup" ? "Store pickup" : "Delivery address"}</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {o.address ? (
              <p>{o.address.name}<br />{o.address.line1}{o.address.line2 ? `, ${o.address.line2}` : ""}<br />{o.address.city}, {o.address.state} – {o.address.pincode}<br />Mobile: {o.address.mobile}</p>
            ) : (
              <p>Collect from Great Foot Wear, Manali.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Payment summary</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Item total</span><span>{formatINR(o.subtotal)}</span></div>
            {Number(o.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Coupon {o.coupon_code}</span><span className="text-emerald-700 dark:text-emerald-400">– {formatINR(o.discount)}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>{Number(o.shipping) ? formatINR(o.shipping) : "Free"}</span></div>
            {Number(o.cod_fee) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">COD fee</span><span>{formatINR(o.cod_fee)}</span></div>}
            <Separator className="my-2" />
            <div className="flex justify-between font-semibold"><span>Total</span><span>{formatINR(o.total)}</span></div>
            <p className="text-xs text-muted-foreground">Includes GST {formatINR(o.tax)} · {o.payment_method === "cod" ? "Cash on Delivery" : "Paid online"}</p>
            {o.refunds.map((r) => (
              <p key={r.id} className="text-xs">Refund {formatINR(r.amount)} – <span className="capitalize">{r.status}</span></p>
            ))}
          </CardContent>
        </Card>
      </div>

      <CancelDialog order={o} open={cancelOpen} onOpenChange={setCancelOpen} />
      <ReturnDialog order={o} item={returnItem} onOpenChange={(v) => !v && setReturnItem(null)} />
    </div>
  )
}
