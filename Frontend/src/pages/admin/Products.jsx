import { useState } from "react"
import { Download, Plus, Upload } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { DataTable, PageHeader, Pager } from "@/components/admin/ui"
import { ProductImage, useDocumentTitle } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { downloadFile, errorMessage } from "@/lib/api"
import { formatINR } from "@/lib/utils"
import { useGetAdminProductsQuery, useImportAdminProductsMutation } from "@/store/api/adminCatalogApi"
import { useGetAdminTaxonomyQuery } from "@/store/api/commonApi"

function ImportDialog({ open, onOpenChange }) {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [importProducts, { isLoading: busy }] = useImportAdminProductsMutation()
  const run = async () => {
    const fd = new FormData()
    fd.append("file", file)
    try {
      setResult(await importProducts(fd).unwrap())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setResult(null); setFile(null) } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk upload products & stock</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel (.xlsx) file with one row per size/colour. Export first to get the exact columns.
            Required in every row: name, category, gender, hsn_code, gst_rate, mrp, price, and sku, size and colour.
            Images cannot be imported, so a new product stays a draft until you add at least one image to it.
            Rows are matched by <code>product_slug</code> and <code>sku</code>; <code>stock_qty</code> sets the absolute stock.
          </DialogDescription>
        </DialogHeader>
        <Input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <Button onClick={run} disabled={!file || busy}>{busy ? "Importing…" : "Import"}</Button>
        {result && (
          <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
            <p>Created {result.created} products, updated {result.updated}, {result.variants} variants processed.</p>
            {result.errors.length > 0 && (
              <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-destructive">
                {result.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {result.warnings?.length > 0 && (
              <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-amber-700 dark:text-amber-400">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function Products() {
  useDocumentTitle("Products")
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [category, setCategory] = useState("all")
  const [page, setPage] = useState(1)
  const [importOpen, setImportOpen] = useState(false)
  const { data: cats = [] } = useGetAdminTaxonomyQuery("categories")
  const { data, isLoading } = useGetAdminProductsQuery({
    q: q || undefined, status: status === "all" ? undefined : status, category_id: category === "all" ? undefined : category, page,
  })

  return (
    <div>
      <PageHeader
        title="Products"
        description="Add and edit products, images and size × colour variants"
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><Download /> Export</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => downloadFile("/admin/products-export", "products.csv", { format: "csv" })}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadFile("/admin/products-export", "products.xlsx", { format: "xlsx" })}>Excel (.xlsx)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setImportOpen(true)}><Upload /> Bulk upload</Button>
            <Button asChild><Link to="/admin/products/new"><Plus /> Add product</Link></Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Search name, slug or SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="max-w-xs" />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1) }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {cats.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.items}
        onRowClick={(p) => navigate(`/admin/products/${p.id}`)}
        columns={[
          { key: "image", header: "", className: "w-14", cell: (p) => <div className="size-10 overflow-hidden rounded bg-muted"><ProductImage src={p.image} alt="" /></div> },
          { key: "name", header: "Product", cell: (p) => <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.brand || "—"} · {p.category || "Uncategorised"}</p></div> },
          { key: "price", header: "Price", cell: (p) => <div>{formatINR(p.price)}<p className="text-xs text-muted-foreground line-through">{formatINR(p.mrp)}</p></div> },
          { key: "variant_count", header: "Variants" },
          { key: "total_stock", header: "Stock", cell: (p) => <Badge variant={p.total_stock ? "outline" : "destructive"}>{p.total_stock}</Badge> },
          { key: "is_active", header: "Status", cell: (p) => <Badge variant={p.is_active ? "success" : "secondary"}>{p.is_active ? "Active" : "Draft"}</Badge> },
        ]}
      />
      <Pager page={page} pageSize={data?.page_size || 25} total={data?.total} onPage={setPage} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
