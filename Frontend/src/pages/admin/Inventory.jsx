import { useState } from "react"
import { History, SlidersHorizontal } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { DataTable, PageHeader, Pager } from "@/components/admin/ui"
import { useDocumentTitle } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/lib/api"
import { formatDate } from "@/lib/utils"
import {
  useAdjustAdminStockMutation,
  useGetAdminInventoryQuery,
  useGetAdminStockHistoryQuery,
  useUpdateAdminStockThresholdMutation,
} from "@/store/api/adminCatalogApi"

const REASONS = [
  { value: "purchase", label: "Purchase (stock in)", sign: 1 },
  { value: "return", label: "Customer return (stock in)", sign: 1 },
  { value: "store_sale", label: "Store sale (stock out)", sign: -1 },
  { value: "damage", label: "Damage (stock out)", sign: -1 },
  { value: "correction", label: "Correction (+/-)", sign: 0 },
]
const REASON_LABEL = {
  purchase: "Purchase", return: "Return", store_sale: "Store sale", damage: "Damage", correction: "Correction",
  order: "Online order", cancellation: "Order cancelled", payment_failed: "Unpaid order released",
}

function AdjustDialog({ row, onClose }) {
  const [reason, setReason] = useState("purchase")
  const [qty, setQty] = useState("")
  const [note, setNote] = useState("")
  const [threshold, setThreshold] = useState(row.low_stock_threshold)
  const sign = REASONS.find((r) => r.value === reason).sign
  const change = sign === 0 ? Number(qty) : sign * Math.abs(Number(qty))
  const [adjustStock] = useAdjustAdminStockMutation()
  const [updateThreshold] = useUpdateAdminStockThresholdMutation()
  // one busy flag across both requests (each mutation refreshes the inventory list itself)
  const [busy, setBusy] = useState(false)
  const adjust = async () => {
    setBusy(true)
    try {
      if (qty !== "" && change !== 0) await adjustStock({ variant_id: row.variant_id, change_qty: change, reason, note: note || null }).unwrap()
      if (Number(threshold) !== row.low_stock_threshold) await updateThreshold({ variantId: row.variant_id, threshold: Number(threshold) }).unwrap()
      toast.success("Stock updated")
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>{row.product_name} · Size {row.size} · {row.colour} · {row.sku} — current stock <strong>{row.stock_qty}</strong></DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="qty">{sign === 0 ? "Change (use − to reduce)" : "Quantity"}</Label>
            <Input id="qty" type="number" value={qty} min={sign === 0 ? undefined : 1} onChange={(e) => setQty(e.target.value)} />
            {qty !== "" && <p className="text-xs text-muted-foreground">New stock: {row.stock_qty + change}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="th">Low-stock threshold</Label>
            <Input id="th" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bill no., supplier, etc." maxLength={255} />
          </div>
        </div>
        <DialogFooter><Button onClick={adjust} disabled={busy}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HistorySheet({ row, onClose }) {
  const { data, isLoading } = useGetAdminStockHistoryQuery({ variant_id: row?.variant_id, page_size: 100 })
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Stock history</SheetTitle>
          <SheetDescription>{row ? `${row.product_name} · ${row.sku}` : "All SKUs, latest first"}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <DataTable
            loading={isLoading}
            rows={data?.items}
            columns={[
              { key: "created_at", header: "When", cell: (m) => formatDate(m.created_at, true) },
              ...(row ? [] : [{ key: "sku", header: "SKU" }]),
              { key: "reason", header: "Reason", cell: (m) => <div>{REASON_LABEL[m.reason] || m.reason}{m.order_no && <p className="text-xs text-muted-foreground">{m.order_no}</p>}{m.note && <p className="text-xs text-muted-foreground">{m.note}</p>}</div> },
              { key: "change_qty", header: "Change", cell: (m) => <span className={m.change_qty > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{m.change_qty > 0 ? `+${m.change_qty}` : m.change_qty}</span> },
              { key: "balance_after", header: "Balance" },
              { key: "user", header: "By", cell: (m) => m.user || "System" },
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default function Inventory() {
  useDocumentTitle("Inventory")
  const [params] = useSearchParams()
  const [q, setQ] = useState("")
  const [low, setLow] = useState(params.get("low_stock") === "1")
  const [page, setPage] = useState(1)
  const [adjusting, setAdjusting] = useState(null)
  const [history, setHistory] = useState(undefined)
  const { data, isLoading } = useGetAdminInventoryQuery({ q: q || undefined, low_stock: low, page })
  return (
    <div>
      <PageHeader
        title="Inventory"
        description="One stock for store and online. Record store sales here the same day to avoid overselling."
        actions={<Button variant="outline" onClick={() => setHistory(null)}><History /> All stock history</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input placeholder="Search product or SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="max-w-xs" />
        <Tabs value={low ? "low" : "all"} onValueChange={(v) => { setLow(v === "low"); setPage(1) }}>
          <TabsList><TabsTrigger value="all">All SKUs</TabsTrigger><TabsTrigger value="low">Low stock</TabsTrigger></TabsList>
        </Tabs>
      </div>
      <DataTable
        rowKey="variant_id"
        loading={isLoading}
        rows={data?.items}
        columns={[
          { key: "product_name", header: "Product", cell: (r) => <span className="font-medium">{r.product_name}</span> },
          { key: "sku", header: "SKU", cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
          { key: "size", header: "Size" },
          { key: "colour", header: "Colour" },
          { key: "stock_qty", header: "Stock", cell: (r) => <Badge variant={r.stock_qty === 0 ? "destructive" : r.is_low ? "warning" : "outline"}>{r.stock_qty}</Badge> },
          { key: "low_stock_threshold", header: "Low at" },
          { key: "is_active", header: "Active", cell: (r) => (r.is_active ? "Yes" : "No") },
          {
            key: "actions", header: "", className: "text-right",
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <Button variant="outline" size="sm" onClick={() => setAdjusting(r)}><SlidersHorizontal /> Adjust</Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setHistory(r)} aria-label="Stock history"><History /></Button>
              </div>
            ),
          },
        ]}
      />
      <Pager page={page} pageSize={data?.page_size || 50} total={data?.total} onPage={setPage} />
      {adjusting && <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} />}
      {history !== undefined && <HistorySheet row={history} onClose={() => setHistory(undefined)} />}
    </div>
  )
}
