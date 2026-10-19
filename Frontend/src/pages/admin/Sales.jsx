import { useState } from "react"
import { ArrowLeft, Check, Download, EyeOff, Image as ImageIcon, PackageCheck, X } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { DataTable, PageHeader, Pager } from "@/components/admin/ui"
import { OrderStatusBadge, PageLoader, ProductImage, RatingStars, useDocumentTitle } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  useActOnAdminRefundMutation,
  useActOnAdminReturnMutation,
  useGetAdminCustomerQuery,
  useGetAdminCustomersQuery,
  useGetAdminPaymentsQuery,
  useGetAdminRefundsQuery,
  useGetAdminReturnsQuery,
  useGetAdminReviewsQuery,
  useModerateAdminReviewMutation,
  useSetAdminCustomerActiveMutation,
} from "@/store/api/adminSalesApi"
import { useAuth } from "@/store/auth"
import { downloadFile, errorMessage } from "@/lib/api"
import { formatDate, formatINR } from "@/lib/utils"

// ------------------------------------------------------------------ Returns & exchanges (AD-08)

const RETURN_STATUS_VARIANT = { requested: "warning", approved: "info", rejected: "destructive", completed: "success" }

function ReturnDialog({ ret, onClose }) {
  const [note, setNote] = useState("")
  const [restock, setRestock] = useState(true)
  const [actOnReturn, { isLoading: acting }] = useActOnAdminReturnMutation()
  const act = (action) =>
    actOnReturn({ id: ret.id, action, note: note || null, restock })
      .unwrap()
      .then(() => {
        toast.success(action === "receive" ? (ret.type === "exchange" ? "Received. Replacement order created." : "Received. Refund triggered.") : `Request ${action}d`)
        onClose()
      })
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="capitalize">{ret.type} request · {ret.order_no}</DialogTitle>
          <DialogDescription>{ret.item?.product_name} · Size {ret.item?.size} · {ret.item?.colour} · Qty {ret.qty}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {ret.type === "exchange" && <p>Wants size <strong>{ret.exchange_variant?.size}</strong> ({ret.exchange_variant?.colour})</p>}
          <p><span className="text-muted-foreground">Reason:</span> {ret.reason}</p>
          {ret.photo_url && <a href={ret.photo_url} target="_blank" rel="noreferrer"><img src={ret.photo_url} alt="Customer photo" className="max-h-56 rounded-md border" /></a>}
          {ret.admin_note && <p><span className="text-muted-foreground">Note:</span> {ret.admin_note}</p>}
          {["requested", "approved"].includes(ret.status) && (
            <div className="space-y-2">
              <Label htmlFor="note">Note to customer</Label>
              <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </div>
          )}
          {ret.status === "approved" && (
            <div className="flex items-center gap-2">
              <Switch id="restock" checked={restock} onCheckedChange={setRestock} />
              <Label htmlFor="restock">Add the returned pair back to stock</Label>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {["requested", "approved"].includes(ret.status) && <Button variant="outline" className="text-destructive" onClick={() => act("reject")} disabled={acting}><X /> Reject</Button>}
          {ret.status === "requested" && <Button onClick={() => act("approve")} disabled={acting}><Check /> Approve</Button>}
          {ret.status === "approved" && (
            <Button onClick={() => act("receive")} disabled={acting}>
              <PackageCheck /> Item received – {ret.type === "exchange" ? "create replacement" : "refund"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminReturns() {
  useDocumentTitle("Returns & exchanges")
  const [status, setStatus] = useState("requested")
  const [open, setOpen] = useState(null)
  // currentData clears on a tab switch, so the table shows its loading state instead of the previous tab
  const { currentData: data, isFetching } = useGetAdminReturnsQuery(status)
  const isLoading = isFetching && !data
  return (
    <div>
      <PageHeader title="Returns & exchanges" description="Approve or reject; on receipt, restock and trigger the refund or replacement order" />
      <Tabs value={status} onValueChange={setStatus} className="mb-4">
        <TabsList>
          <TabsTrigger value="requested">New</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        loading={isLoading}
        rows={data}
        onRowClick={setOpen}
        columns={[
          { key: "order_no", header: "Order", cell: (r) => <Link to={`/admin/orders/${r.order_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{r.order_no}</Link> },
          { key: "item", header: "Item", cell: (r) => <div className="flex items-center gap-2"><span className="size-10 overflow-hidden rounded bg-muted"><ProductImage src={r.item?.image_url} alt="" /></span><span>{r.item?.product_name}<br /><span className="text-xs text-muted-foreground">Size {r.item?.size} · {r.item?.colour}</span></span></div> },
          { key: "type", header: "Type", cell: (r) => <span className="capitalize">{r.type}{r.type === "exchange" && r.exchange_variant ? ` → ${r.exchange_variant.size}` : ""}</span> },
          { key: "photo", header: "Photo", cell: (r) => (r.photo_url ? <ImageIcon className="size-4 text-muted-foreground" /> : "—") },
          { key: "status", header: "Status", cell: (r) => <Badge variant={RETURN_STATUS_VARIANT[r.status]} className="capitalize">{r.status}</Badge> },
          { key: "created_at", header: "Requested", cell: (r) => formatDate(r.created_at) },
        ]}
      />
      {open && <ReturnDialog ret={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

// ------------------------------------------------------------------ Payments & refunds (AD-09)

export function AdminPayments() {
  useDocumentTitle("Payments & refunds")
  const navigate = useNavigate()
  const [tab, setTab] = useState("transactions")
  const [page, setPage] = useState(1)
  const payments = useGetAdminPaymentsQuery({ page, status: tab === "failed" ? "failed" : undefined }, { skip: tab === "refunds" })
  const refunds = useGetAdminRefundsQuery(undefined, { skip: tab !== "refunds" })
  const [actOnRefund, { isLoading: acting }] = useActOnAdminRefundMutation()
  const act = (arg) =>
    actOnRefund(arg)
      .unwrap()
      .then(() => toast.success("Refund updated"))
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <div>
      <PageHeader title="Payments & refunds" description="Payments are marked paid only after Razorpay signature / webhook verification" />
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1) }} className="mb-4">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="failed">Failed payments</TabsTrigger>
          <TabsTrigger value="refunds">Refunds</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "refunds" ? (
        <DataTable
          loading={refunds.isLoading}
          rows={refunds.data}
          columns={[
            { key: "order_no", header: "Order", cell: (r) => <Link to={`/admin/orders/${r.order_id}`} className="font-medium text-primary hover:underline">{r.order_no}</Link> },
            { key: "amount", header: "Amount", cell: (r) => formatINR(r.amount) },
            { key: "mode", header: "Mode", cell: (r) => (r.mode === "gateway" ? "Razorpay" : "Manual (bank/UPI)") },
            { key: "reason", header: "Reason" },
            { key: "status", header: "Status", cell: (r) => <Badge variant={r.status === "processed" ? "success" : r.status === "requested" ? "warning" : r.status === "failed" ? "destructive" : "outline"} className="capitalize">{r.status}</Badge> },
            { key: "created_at", header: "Date", cell: (r) => formatDate(r.created_at, true) },
            {
              key: "actions", header: "", className: "text-right",
              cell: (r) => ["requested", "failed"].includes(r.status) && (
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => act({ id: r.id, action: "approve" })} disabled={acting}>
                    {r.mode === "manual" ? "Mark as paid" : r.status === "failed" ? "Retry" : "Approve"}
                  </Button>
                  {r.status === "requested" && <Button size="sm" variant="outline" onClick={() => act({ id: r.id, action: "reject" })}>Reject</Button>}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <>
          <DataTable
            loading={payments.isLoading}
            rows={payments.data?.items}
            onRowClick={(p) => navigate(`/admin/orders/${p.order_id}`)}
            columns={[
              { key: "created_at", header: "Date", cell: (p) => formatDate(p.created_at, true) },
              { key: "order_no", header: "Order" },
              { key: "gateway", header: "Gateway", cell: (p) => (p.gateway === "cod" ? "COD" : "Razorpay") },
              { key: "method", header: "Method", cell: (p) => <span className="uppercase">{p.method || "—"}</span> },
              { key: "ids", header: "Gateway IDs", cell: (p) => <span className="font-mono text-xs">{p.gateway_payment_id || p.gateway_order_id || "—"}</span> },
              { key: "amount", header: "Amount", cell: (p) => formatINR(p.amount) },
              { key: "status", header: "Status", cell: (p) => <div><Badge variant={p.status === "captured" || p.status === "cod_collected" ? "success" : p.status === "failed" ? "destructive" : "outline"} className="capitalize">{p.status.replace("_", " ")}</Badge>{p.error_reason && <p className="text-xs text-muted-foreground">{p.error_reason}</p>}</div> },
            ]}
          />
          <Pager page={page} pageSize={payments.data?.page_size || 50} total={payments.data?.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Customers (AD-10, UM-16)

export function AdminCustomers() {
  useDocumentTitle("Customers")
  const { user } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const { data, isLoading } = useGetAdminCustomersQuery({ q: q || undefined, page })
  return (
    <div>
      <PageHeader
        title="Customers"
        actions={user.role === "admin" && <Button variant="outline" onClick={() => downloadFile("/admin/customers-export", "customers.csv", { q: q || undefined })}><Download /> Export CSV</Button>}
      />
      <Input placeholder="Search name, email or mobile" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="mb-4 max-w-xs" />
      <DataTable
        loading={isLoading}
        rows={data?.items}
        onRowClick={(c) => navigate(`/admin/customers/${c.id}`)}
        columns={[
          { key: "name", header: "Name", cell: (c) => <span className="font-medium">{c.name}</span> },
          { key: "contact", header: "Contact", cell: (c) => <div>{c.mobile}<p className="text-xs text-muted-foreground">{c.email}</p></div> },
          { key: "order_count", header: "Orders" },
          { key: "total_spent", header: "Spent", cell: (c) => formatINR(c.total_spent) },
          { key: "is_verified", header: "Verified", cell: (c) => (c.is_verified ? "Yes" : "No") },
          { key: "is_active", header: "Status", cell: (c) => <Badge variant={c.is_active ? "success" : "destructive"}>{c.is_active ? "Active" : "Blocked"}</Badge> },
          { key: "created_at", header: "Joined", cell: (c) => formatDate(c.created_at) },
        ]}
      />
      <Pager page={page} pageSize={data?.page_size || 25} total={data?.total} onPage={setPage} />
    </div>
  )
}

export function AdminCustomerDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  // currentData is empty while a different customer loads, so the loader shows instead of the previous one
  const { currentData: c, isFetching } = useGetAdminCustomerQuery(id)
  const [setActive] = useSetAdminCustomerActiveMutation()
  // no error toast, as before
  const block = () =>
    setActive({ id, is_active: !c.is_active })
      .unwrap()
      .then(() => toast.success(c.is_active ? "Customer blocked" : "Customer unblocked"))
      .catch(() => {})
  useDocumentTitle(c?.name || "Customer")
  if (isFetching && !c) return <PageLoader />
  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={`${c.mobile} · ${c.email} · joined ${formatDate(c.created_at)}`}
        actions={
          <>
            <Button variant="ghost" asChild><Link to="/admin/customers"><ArrowLeft /> Customers</Link></Button>
            {user.role === "admin" && <Button variant={c.is_active ? "destructive" : "default"} onClick={block}>{c.is_active ? "Block customer" : "Unblock customer"}</Button>}
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge variant={c.is_active ? "success" : "destructive"}>{c.is_active ? "Active" : "Blocked"}</Badge>
        <Badge variant={c.mobile_verified ? "success" : "warning"}>Mobile {c.mobile_verified ? "verified" : "unverified"}</Badge>
        <Badge variant={c.email_verified ? "success" : "warning"}>Email {c.email_verified ? "verified" : "unverified"}</Badge>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-3 font-semibold">Orders</h2>
          <DataTable
            rows={c.orders}
            onRowClick={(o) => navigate(`/admin/orders/${o.id}`)}
            columns={[
              { key: "order_no", header: "Order" },
              { key: "created_at", header: "Date", cell: (o) => formatDate(o.created_at) },
              { key: "status", header: "Status", cell: (o) => <OrderStatusBadge status={o.order_status} /> },
              { key: "total", header: "Total", cell: (o) => formatINR(o.total) },
            ]}
          />
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Addresses</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {c.addresses.length === 0 && <p className="text-muted-foreground">No saved addresses.</p>}
            {c.addresses.map((a) => (
              <p key={a.id} className="text-muted-foreground"><span className="font-medium text-foreground">{a.name}</span>{a.is_default && " (default)"}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} – {a.pincode}</p>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Reviews (AD-13)

export function AdminReviews() {
  useDocumentTitle("Reviews")
  const [status, setStatus] = useState("pending")
  // currentData clears on a tab switch, so the table shows its loading state instead of the previous tab
  const { currentData: data, isFetching } = useGetAdminReviewsQuery(status)
  const isLoading = isFetching && !data
  const [moderateReview] = useModerateAdminReviewMutation()
  // no error toast, as before
  const moderate = (arg) =>
    moderateReview(arg)
      .unwrap()
      .then(() => toast.success("Review updated"))
      .catch(() => {})
  return (
    <div>
      <PageHeader title="Reviews" description="Only verified buyers can review. Approve to publish, hide to remove from the store." />
      <Tabs value={status} onValueChange={setStatus} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Published</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        loading={isLoading}
        rows={data}
        columns={[
          { key: "product", header: "Product", cell: (r) => <a href={`/product/${r.product_slug}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.product_name}</a> },
          { key: "rating", header: "Rating", cell: (r) => <RatingStars value={r.rating} /> },
          { key: "comment", header: "Review", cell: (r) => <div className="max-w-md"><p>{r.comment || "—"}</p><p className="text-xs text-muted-foreground">{r.user_name} · {formatDate(r.created_at)}</p></div> },
          { key: "status", header: "Status", cell: (r) => <Badge variant={r.is_approved ? "success" : "warning"}>{r.is_approved ? "Published" : "Pending"}</Badge> },
          {
            key: "actions", header: "", className: "text-right",
            cell: (r) => r.is_approved
              ? <Button size="sm" variant="outline" onClick={() => moderate({ id: r.id, is_approved: false })}><EyeOff /> Hide</Button>
              : <Button size="sm" onClick={() => moderate({ id: r.id, is_approved: true })}><Check /> Approve</Button>,
          },
        ]}
      />
    </div>
  )
}
