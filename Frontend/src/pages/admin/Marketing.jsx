import { useEffect, useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ImageUpload } from "@/components/admin/ImageUpload"
import { DataTable, PageHeader } from "@/components/admin/ui"
import { useDocumentTitle } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/api"
import { formatDate, formatINR } from "@/lib/utils"
import {
  useDeleteAdminBannerMutation,
  useDeleteAdminCouponMutation,
  useGetAdminBannersQuery,
  useGetAdminCouponsQuery,
  useGetAdminPagesQuery,
  useSaveAdminBannerMutation,
  useSaveAdminCouponMutation,
  useUpdateAdminPageMutation,
} from "@/store/api/adminBusinessApi"
import { useGetAdminTaxonomyQuery } from "@/store/api/commonApi"

function F({ label, children, className }) {
  return <div className={`space-y-2 ${className || ""}`}><Label>{label}</Label>{children}</div>
}

const toLocal = (iso) => (iso ? iso.slice(0, 16) : "")

// ------------------------------------------------------------------ Coupons (AD-11)

function CouponDialog({ coupon, onClose }) {
  const { data: cats = [] } = useGetAdminTaxonomyQuery("categories")
  const [v, setV] = useState(() => ({
    code: coupon?.code || "", description: coupon?.description || "", type: coupon?.type || "percent", value: coupon?.value ?? "",
    min_order: coupon?.min_order ?? 0, max_discount: coupon?.max_discount ?? "", valid_from: toLocal(coupon?.valid_from), valid_to: toLocal(coupon?.valid_to),
    usage_limit: coupon?.usage_limit ?? "", per_user_limit: coupon?.per_user_limit ?? "", first_order_only: coupon?.first_order_only ?? false,
    category_ids: coupon?.category_ids || [], product_ids: (coupon?.product_ids || []).join(", "), is_active: coupon?.is_active ?? true,
  }))
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const n = (x) => (x === "" || x === null ? null : Number(x))
  const [saveCoupon, { isLoading: saving }] = useSaveAdminCouponMutation()
  const save = () => {
    const body = {
      ...v, value: Number(v.value), min_order: Number(v.min_order || 0), max_discount: n(v.max_discount), usage_limit: n(v.usage_limit),
      per_user_limit: n(v.per_user_limit), valid_from: v.valid_from || null, valid_to: v.valid_to || null, description: v.description || null,
      product_ids: v.product_ids.split(",").map((x) => Number(x.trim())).filter(Boolean),
    }
    saveCoupon({ id: coupon?.id, ...body })
      .unwrap()
      .then(() => { toast.success("Coupon saved"); onClose() })
      .catch((e) => toast.error(errorMessage(e)))
  }
  const toggleCat = (id) => setV((s) => ({ ...s, category_ids: s.category_ids.includes(id) ? s.category_ids.filter((x) => x !== id) : [...s.category_ids, id] }))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{coupon?.id ? "Edit coupon" : "New coupon"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Code"><Input value={v.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} placeholder="WELCOME10" /></F>
          <F label="Description (optional)"><Input value={v.description} onChange={set("description")} /></F>
          <F label="Type">
            <Select value={v.type} onValueChange={set("type")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="percent">Percent (%)</SelectItem><SelectItem value="flat">Flat (₹)</SelectItem></SelectContent>
            </Select>
          </F>
          <F label={v.type === "percent" ? "Discount %" : "Discount ₹"}><Input type="number" min={0} value={v.value} onChange={set("value")} /></F>
          <F label="Minimum order (₹)"><Input type="number" min={0} value={v.min_order} onChange={set("min_order")} /></F>
          <F label="Maximum discount (₹, optional)"><Input type="number" min={0} value={v.max_discount} onChange={set("max_discount")} /></F>
          <F label="Valid from"><Input type="datetime-local" value={v.valid_from} onChange={set("valid_from")} /></F>
          <F label="Valid to"><Input type="datetime-local" value={v.valid_to} onChange={set("valid_to")} /></F>
          <F label="Total usage limit (optional)"><Input type="number" min={1} value={v.usage_limit} onChange={set("usage_limit")} /></F>
          <F label="Uses per customer (optional)"><Input type="number" min={1} value={v.per_user_limit} onChange={set("per_user_limit")} /></F>
          <F label="Restrict to categories (optional)" className="sm:col-span-2">
            <ScrollArea className="h-28 rounded-md border p-2">
              <div className="grid grid-cols-2 gap-2">
                {cats.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm"><Checkbox checked={v.category_ids.includes(c.id)} onCheckedChange={() => toggleCat(c.id)} />{c.name}</label>
                ))}
              </div>
            </ScrollArea>
          </F>
          <F label="Restrict to product IDs (optional, comma separated)" className="sm:col-span-2"><Input value={v.product_ids} onChange={set("product_ids")} placeholder="e.g. 12, 15" /></F>
          <div className="flex items-center gap-2"><Switch id="fo" checked={v.first_order_only} onCheckedChange={set("first_order_only")} /><Label htmlFor="fo">First order only</Label></div>
          <div className="flex items-center gap-2"><Switch id="ac" checked={v.is_active} onCheckedChange={set("is_active")} /><Label htmlFor="ac">Active</Label></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={!v.code || !v.value || saving}>Save coupon</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminCoupons() {
  useDocumentTitle("Coupons")
  const [editing, setEditing] = useState(null)
  const { data, isLoading } = useGetAdminCouponsQuery(undefined)
  const [deleteCoupon] = useDeleteAdminCouponMutation()
  const del = (id) => deleteCoupon(id).unwrap().then((r) => toast.success(r.message)).catch(() => {})
  return (
    <div>
      <PageHeader title="Coupons" description="Discount codes customers apply in the cart" actions={<Button onClick={() => setEditing({})}><Plus /> New coupon</Button>} />
      <DataTable
        loading={isLoading}
        rows={data}
        columns={[
          { key: "code", header: "Code", cell: (c) => <div><span className="font-mono font-medium">{c.code}</span>{c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}</div> },
          { key: "value", header: "Discount", cell: (c) => (c.type === "percent" ? `${Number(c.value)}%${c.max_discount ? ` (max ${formatINR(c.max_discount)})` : ""}` : formatINR(c.value)) },
          { key: "min_order", header: "Min order", cell: (c) => formatINR(c.min_order) },
          { key: "validity", header: "Validity", cell: (c) => <span className="text-xs">{c.valid_from ? formatDate(c.valid_from) : "—"} → {c.valid_to ? formatDate(c.valid_to) : "no expiry"}</span> },
          { key: "used", header: "Used", cell: (c) => `${c.used}${c.usage_limit ? ` / ${c.usage_limit}` : ""}` },
          { key: "rules", header: "Rules", cell: (c) => <div className="flex flex-wrap gap-1">{c.first_order_only && <Badge variant="outline">First order</Badge>}{c.per_user_limit && <Badge variant="outline">{c.per_user_limit}/customer</Badge>}{(c.category_ids.length > 0 || c.product_ids.length > 0) && <Badge variant="outline">Restricted</Badge>}</div> },
          { key: "is_active", header: "Status", cell: (c) => <Badge variant={c.is_active ? "success" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge> },
          {
            key: "actions", header: "", className: "text-right",
            cell: (c) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(c)} aria-label="Edit"><Pencil /></Button>
                <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(c.id)} aria-label="Delete"><Trash2 /></Button>
              </div>
            ),
          },
        ]}
      />
      {editing && <CouponDialog coupon={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ------------------------------------------------------------------ Content (AD-12)

function BannerDialog({ banner, onClose }) {
  const [v, setV] = useState(() => ({
    kind: banner?.kind || "banner", title: banner?.title || "", subtitle: banner?.subtitle || "", image_url: banner?.image_url || null,
    link_url: banner?.link_url || "", sort_order: banner?.sort_order ?? 0, is_active: banner?.is_active ?? true,
  }))
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const [saveBanner, { isLoading: saving }] = useSaveAdminBannerMutation()
  const save = () => {
    const body = { ...v, subtitle: v.subtitle || null, link_url: v.link_url || null, sort_order: Number(v.sort_order || 0) }
    saveBanner({ id: banner?.id, ...body })
      .unwrap()
      .then(() => { toast.success("Saved"); onClose() })
      .catch((e) => toast.error(errorMessage(e)))
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{banner?.id ? "Edit" : "New"} {v.kind === "banner" ? "banner" : "offer strip"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <F label="Type">
            <Select value={v.kind} onValueChange={set("kind")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="banner">Home banner (image slider)</SelectItem><SelectItem value="offer_strip">Offer strip (text bar on top)</SelectItem></SelectContent>
            </Select>
          </F>
          <F label="Title"><Input value={v.title} onChange={set("title")} /></F>
          <F label="Subtitle (optional)"><Input value={v.subtitle} onChange={set("subtitle")} /></F>
          {v.kind === "banner" && <F label="Image (wide, e.g. 1600 × 500)"><ImageUpload value={v.image_url} onChange={set("image_url")} folder="banners" className="h-20 w-48" /></F>}
          <F label="Link (optional)"><Input value={v.link_url} onChange={set("link_url")} placeholder="/category/men" /></F>
          <div className="flex items-center gap-4">
            <F label="Order"><Input type="number" className="w-24" value={v.sort_order} onChange={set("sort_order")} /></F>
            <div className="flex items-center gap-2 pt-6"><Switch id="ba" checked={v.is_active} onCheckedChange={set("is_active")} /><Label htmlFor="ba">Active</Label></div>
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={!v.title || saving}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PageEditor({ page }) {
  const [v, setV] = useState({ title: page.title, content: page.content })
  useEffect(() => {
    setV({ title: page.title, content: page.content })
  }, [page])
  const [updatePage, { isLoading: saving }] = useUpdateAdminPageMutation()
  const save = () =>
    updatePage({ slug: page.slug, ...v })
      .unwrap()
      .then(() => toast.success("Page saved"))
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">/{page.slug}</CardTitle>
        <a href={`/${page.slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">View page</a>
      </CardHeader>
      <CardContent className="space-y-3">
        <F label="Title"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></F>
        <F label="Content (plain text, line breaks are kept)"><Textarea rows={14} value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} /></F>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Last updated {formatDate(page.updated_at, true)}</span>
          <Button onClick={save} disabled={saving}>Save page</Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function AdminContent() {
  useDocumentTitle("Banners & pages")
  const [editing, setEditing] = useState(null)
  const [pageSlug, setPageSlug] = useState("about")
  const { data: banners, isLoading } = useGetAdminBannersQuery(undefined)
  const { data: pages = [] } = useGetAdminPagesQuery(undefined)
  const [deleteBanner] = useDeleteAdminBannerMutation()
  const page = pages.find((p) => p.slug === pageSlug)
  return (
    <div>
      <PageHeader title="Banners & pages" description="Home banners, offer strips and the store policy pages" />
      <Tabs defaultValue="banners">
        <TabsList className="mb-4"><TabsTrigger value="banners">Banners & offer strips</TabsTrigger><TabsTrigger value="pages">Static pages</TabsTrigger></TabsList>
        <TabsContent value="banners" className="space-y-4">
          <Button onClick={() => setEditing({})}><Plus /> New banner / offer strip</Button>
          <DataTable
            loading={isLoading}
            rows={banners}
            columns={[
              { key: "image", header: "", className: "w-28", cell: (b) => <div className="h-10 w-24 overflow-hidden rounded bg-muted">{b.image_url && <img src={b.image_url} alt="" className="size-full object-cover" />}</div> },
              { key: "kind", header: "Type", cell: (b) => (b.kind === "banner" ? "Banner" : "Offer strip") },
              { key: "title", header: "Title", cell: (b) => <div><p className="font-medium">{b.title}</p>{b.subtitle && <p className="text-xs text-muted-foreground">{b.subtitle}</p>}</div> },
              { key: "link_url", header: "Link" },
              { key: "sort_order", header: "Order" },
              { key: "is_active", header: "Status", cell: (b) => <Badge variant={b.is_active ? "success" : "secondary"}>{b.is_active ? "Active" : "Hidden"}</Badge> },
              {
                key: "actions", header: "", className: "text-right",
                cell: (b) => (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(b)} aria-label="Edit"><Pencil /></Button>
                    <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => deleteBanner(b.id)} aria-label="Delete"><Trash2 /></Button>
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="pages" className="space-y-4">
          <Select value={pageSlug} onValueChange={setPageSlug}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>{pages.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.title}</SelectItem>)}</SelectContent>
          </Select>
          {page && <PageEditor page={page} />}
        </TabsContent>
      </Tabs>
      {editing && <BannerDialog banner={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </div>
  )
}
