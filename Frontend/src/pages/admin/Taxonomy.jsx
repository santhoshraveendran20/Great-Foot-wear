import { useState } from "react"
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ImageUpload } from "@/components/admin/ImageUpload"
import { DataTable, PageHeader } from "@/components/admin/ui"
import { useDocumentTitle } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/api"
import { useDeleteAdminTaxonomyMutation, useReorderAdminCategoriesMutation, useSaveAdminTaxonomyMutation } from "@/store/api/adminCatalogApi"
import { useGetAdminTaxonomyQuery } from "@/store/api/commonApi"

function EditDialog({ kind, item, categories, onClose }) {
  const isCat = kind === "categories"
  const [v, setV] = useState(() => ({
    name: item?.name || "",
    slug: item?.slug || "",
    parent_id: item?.parent_id ?? null,
    image: (isCat ? item?.image_url : item?.logo_url) || null,
    is_active: item?.is_active ?? true,
  }))
  const [saveItem, { isLoading: saving }] = useSaveAdminTaxonomyMutation()
  const save = () => {
    const body = isCat
      ? { name: v.name, slug: v.slug || null, parent_id: v.parent_id, image_url: v.image, sort_order: item?.sort_order ?? 0, is_active: v.is_active }
      : { name: v.name, slug: v.slug || null, logo_url: v.image, is_active: v.is_active }
    saveItem({ kind, id: item?.id, body })
      .unwrap()
      .then(() => {
        toast.success("Saved")
        onClose()
      })
      .catch((e) => toast.error(errorMessage(e)))
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item?.id ? "Edit" : "Add"} {isCat ? "category" : "brand"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="n">Name</Label><Input id="n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="s">URL slug (optional)</Label><Input id="s" value={v.slug} placeholder="auto from name" onChange={(e) => setV({ ...v, slug: e.target.value })} /></div>
          {isCat && (
            <div className="space-y-2">
              <Label>Parent category</Label>
              <Select value={v.parent_id ? String(v.parent_id) : "none"} onValueChange={(x) => setV({ ...v, parent_id: x === "none" ? null : Number(x) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (top level)</SelectItem>
                  {categories.filter((c) => c.id !== item?.id).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2"><Label>{isCat ? "Image" : "Logo"}</Label><ImageUpload value={v.image} onChange={(url) => setV({ ...v, image: url })} folder={kind} /></div>
          <div className="flex items-center gap-2"><Switch id="a" checked={v.is_active} onCheckedChange={(x) => setV({ ...v, is_active: x })} /><Label htmlFor="a">Active</Label></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={v.name.trim().length < 1 || saving}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Taxonomy({ kind, title }) {
  useDocumentTitle(title)
  const [editing, setEditing] = useState(null)
  const { data = [], isLoading } = useGetAdminTaxonomyQuery(kind)
  const isCat = kind === "categories"
  const [deleteItem] = useDeleteAdminTaxonomyMutation()
  const del = (id) =>
    deleteItem({ kind, id })
      .unwrap()
      .then(() => toast.success("Deleted"))
      .catch((e) => toast.error(errorMessage(e)))
  const [reorder] = useReorderAdminCategoriesMutation()
  const move = (idx, dir) => {
    const ids = data.map((c) => c.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    reorder(ids)
  }
  const nameOf = (id) => data.find((c) => c.id === id)?.name

  const columns = [
    {
      key: "image", header: "", className: "w-14",
      cell: (r) => <div className="size-10 overflow-hidden rounded bg-muted">{(r.image_url || r.logo_url) && <img src={r.image_url || r.logo_url} alt="" className="size-full object-cover" />}</div>,
    },
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "slug", header: "Slug", cell: (r) => <span className="text-muted-foreground">{r.slug}</span> },
    ...(isCat ? [{ key: "parent", header: "Parent", cell: (r) => nameOf(r.parent_id) || "—" }] : []),
    { key: "product_count", header: "Products" },
    { key: "is_active", header: "Status", cell: (r) => <Badge variant={r.is_active ? "success" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    {
      key: "actions", header: "", className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {isCat && (
            <>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => move(data.indexOf(r), -1)} aria-label="Move up"><ArrowUp /></Button>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => move(data.indexOf(r), 1)} aria-label="Move down"><ArrowDown /></Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(r)} aria-label="Edit"><Pencil /></Button>
          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(r.id)} aria-label="Delete"><Trash2 /></Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title={title} actions={<Button onClick={() => setEditing({})}><Plus /> Add {isCat ? "category" : "brand"}</Button>} />
      <DataTable columns={columns} rows={data} loading={isLoading} />
      {editing && <EditDialog kind={kind} item={editing.id ? editing : null} categories={isCat ? data : []} onClose={() => setEditing(null)} />}
    </div>
  )
}

export const Categories = () => <Taxonomy kind="categories" title="Categories" />
export const Brands = () => <Taxonomy kind="brands" title="Brands" />
