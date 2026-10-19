import { useEffect, useRef, useState } from "react"
import { AlertCircle, ArrowLeft, ArrowRight, ExternalLink, Eye, EyeOff, ImagePlus, Loader2, Plus, Trash2, Wand2, X } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { PageHeader } from "@/components/admin/ui"
import { PageLoader, useDocumentTitle } from "@/components/common"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  useDeleteAdminProductImageMutation,
  useDeleteAdminProductMutation,
  useGetAdminProductQuery,
  useReorderAdminProductImagesMutation,
  useSaveAdminProductMutation,
  useUploadAdminProductImagesMutation,
} from "@/store/api/adminCatalogApi"
import { useGetAdminTaxonomyQuery } from "@/store/api/commonApi"

const EMPTY = {
  name: "", slug: "", brand_id: null, category_id: null, gender: null, description: "", material: "", care: "", size_chart: "",
  // new products are visible in the store by default; switch Visibility off to keep one as a draft
  hsn_code: "", gst_rate: "", mrp: "", price: "", tags: "", is_active: true, variants: [],
}

// GST slab rates; must match GST_RATES in Backend/app/schemas.py
const GST_RATES = [0, 5, 12, 18, 28, 40]
const DEFAULT_LOW_STOCK = 3
const isBlank = (x) => x === null || x === undefined || String(x).trim() === ""
const isWhole = (x) => /^\d+$/.test(String(x).trim())

/**
 * Mandatory: name, gender, category, MRP, selling price, HSN code, GST %, at least one image and at least one
 * variant (SKU, size, colour and opening stock). Brand, slug, description, material, tags, care, size chart,
 * price override and low-stock level are optional. The API enforces the same rules (ProductIn).
 * Returns { fieldKey: message }; variant keys look like "v.0.sku".
 */
function validate(v, imageCount, generatorTyping = false) {
  const e = {}
  if (imageCount < 1) e.images = "Add at least one product image"
  if (v.name.trim().length < 2) e.name = "Enter the product name"
  if (!v.gender) e.gender = "Select a gender"
  if (!v.category_id) e.category_id = "Select a category"
  const mrp = Number(v.mrp)
  const price = Number(v.price)
  if (isBlank(v.mrp) || !(mrp > 0)) e.mrp = "MRP must be more than ₹0"
  if (isBlank(v.price) || !(price > 0)) e.price = "Selling price must be more than ₹0"
  else if (mrp > 0 && price > mrp) e.price = "Selling price cannot be more than MRP"
  if (!/^\d{4,8}$/.test((v.hsn_code || "").trim())) e.hsn_code = "Enter the HSN code (4 to 8 digits)"
  if (isBlank(v.gst_rate)) e.gst_rate = "Select the GST rate"
  if (!v.variants.length) {
    e.variants = generatorTyping
      ? "You typed sizes and colours but did not click Generate. Click Generate to add them as variants."
      : "Add at least one variant: type sizes and colours and click Generate, or click Add row"
  }

  const skus = new Map()
  const combos = new Map()
  v.variants.forEach((x, i) => {
    const sku = String(x.sku || "").trim().toUpperCase()
    if (!sku) e[`v.${i}.sku`] = "SKU is required"
    else if (skus.has(sku)) e[`v.${i}.sku`] = `SKU ${sku} is used twice`
    else skus.set(sku, i)
    if (isBlank(x.size)) e[`v.${i}.size`] = "Size is required"
    if (isBlank(x.colour)) e[`v.${i}.colour`] = "Colour is required"
    if (!isBlank(x.size) && !isBlank(x.colour)) {
      const combo = `${String(x.size).trim().toLowerCase()}|${String(x.colour).trim().toLowerCase()}`
      if (combos.has(combo)) e[`v.${i}.colour`] = `Size ${x.size} in ${x.colour} is added twice`
      else combos.set(combo, i)
    }
    // stock of saved variants is changed from Inventory, so only new rows carry an opening stock
    if (!x.id && !isWhole(x.stock_qty)) e[`v.${i}.stock_qty`] = "Stock must be 0 or a whole number"
    if (!isBlank(x.price_override)) {
      const o = Number(x.price_override)
      if (!(o > 0)) e[`v.${i}.price_override`] = "Price override must be more than ₹0"
      else if (mrp > 0 && o > mrp) e[`v.${i}.price_override`] = "Price override cannot be more than MRP"
    }
    if (!isBlank(x.low_stock_threshold) && !isWhole(x.low_stock_threshold)) e[`v.${i}.low_stock_threshold`] = "Low-stock level must be 0 or a whole number"
  })
  return e
}

const LABELS = { name: "Name", gender: "Gender", category_id: "Category", mrp: "MRP", price: "Selling price", hsn_code: "HSN code", gst_rate: "GST %" }
const VARIANT_LABELS = { sku: "SKU", size: "Size", colour: "Colour", stock_qty: "Stock", price_override: "Price override", low_stock_threshold: "Low-stock at" }

/** Readable list for the error summary, in the order the fields appear on the page. */
function errorList(e, variants) {
  const out = Object.keys(LABELS).filter((k) => e[k]).map((k) => `${LABELS[k]}: ${e[k]}`)
  if (e.variants) out.push(`Variants: ${e.variants}`)
  variants.forEach((x, i) => {
    Object.keys(VARIANT_LABELS).forEach((k) => {
      if (e[`v.${i}.${k}`]) out.push(`Variant ${i + 1}${x.sku ? ` (${x.sku})` : ""}: ${e[`v.${i}.${k}`]}`)
    })
  })
  if (e.images) out.push(`Images: ${e.images}`)
  return out
}

function F({ label, children, hint, className, required, error }) {
  return (
    <div className={cn("space-y-2", error && "[&_button[role=combobox]]:border-destructive [&_input]:border-destructive", className)}>
      <Label className={cn(error && "text-destructive")}>
        {label}
        {required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </Label>
      {children}
      {error ? <p className="text-[0.8rem] font-medium text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

const cellError = (msg) => (msg ? "border-destructive" : undefined)

function VariantGenerator({ base, onAdd, onTypingChange }) {
  const [sizes, setSizes] = useState("")
  const [colours, setColours] = useState("")
  // sizes / colours typed but not yet turned into variant rows: easy to miss, so the form reports it on Save
  const typing = Boolean(sizes.trim() || colours.trim())
  useEffect(() => onTypingChange?.(typing), [typing, onTypingChange])
  const gen = () => {
    const ss = sizes.split(",").map((s) => s.trim()).filter(Boolean)
    const cs = colours.split(",").map((s) => s.trim()).filter(Boolean)
    if (!ss.length || !cs.length) return toast.error("Enter at least one size and one colour")
    const prefix = (base || "SKU").toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20).replace(/-$/, "")
    onAdd(cs.flatMap((c) => ss.map((s) => ({
      sku: `${prefix}-${c.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 4)}-${s.replace(/[^A-Za-z0-9.]+/g, "")}`,
      size: s, colour: c, stock_qty: 0, price_override: "", low_stock_threshold: 3, is_active: true,
    }))))
    setSizes("")
    setColours("")
  }
  return (
    <div className="space-y-2 rounded-md bg-muted/50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <F label="Sizes (comma separated)" className="min-w-40 flex-1"><Input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="6, 7, 8, 9, 10" /></F>
        <F label="Colours (comma separated)" className="min-w-40 flex-1"><Input value={colours} onChange={(e) => setColours(e.target.value)} placeholder="Black, Brown" /></F>
        <Button type="button" variant={typing ? "default" : "secondary"} onClick={gen}><Wand2 /> Generate</Button>
      </div>
      {typing && <p className="text-xs text-muted-foreground">Click <strong>Generate</strong> to add these sizes and colours as variant rows below.</p>}
    </div>
  )
}

// same limits as the API (Backend/app/services/media.py); every upload is converted to WebP there
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_IMAGE_MB = 8
const MAX_IMAGES = 8

/** Keeps JPG / PNG / WebP files up to 8 MB and explains why any others were skipped. */
function acceptedImages(files) {
  return Array.from(files || []).filter((f) => {
    if (!IMAGE_TYPES.includes(f.type)) {
      toast.error(`${f.name}: only JPG, PNG or WebP images can be added`)
      return false
    }
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast.error(`${f.name} is larger than ${MAX_IMAGE_MB} MB`)
      return false
    }
    return true
  })
}

/**
 * Product images (at least one is mandatory). For a saved product each change goes to the API straight away;
 * on "Add product" the picked files wait in `pending` and are sent together with the product when it is saved.
 */
function Images({ product, pending, setPending, saving, error }) {
  // each of these writes the updated product into the getAdminProduct cache
  const [uploadImages, { isLoading: busy }] = useUploadAdminProductImagesMutation()
  const [reorderImages] = useReorderAdminProductImagesMutation()
  const [deleteImage, { isLoading: deleting }] = useDeleteAdminProductImageMutation()
  const [dragging, setDragging] = useState(false)
  const items = product ? product.images.map((im) => ({ key: im.id, url: im.url })) : pending
  // the last image of a saved product cannot be removed (the API refuses it too); one delete at a time
  const canRemove = !product || (items.length > 1 && !deleting)

  const add = async (files) => {
    let ok = acceptedImages(files)
    if (!ok.length) return
    if (items.length + ok.length > MAX_IMAGES) {
      toast.error(`A product can have at most ${MAX_IMAGES} images (4–6 recommended)`)
      ok = ok.slice(0, Math.max(0, MAX_IMAGES - items.length))
      if (!ok.length) return
    }
    if (!product) {
      // object URLs are made outside the state updater (StrictMode runs updaters twice)
      const entries = ok.map((file) => ({ key: `${file.name}-${file.lastModified}-${Math.random()}`, file, url: URL.createObjectURL(file) }))
      setPending((list) => [...list, ...entries])
      return
    }
    const fd = new FormData()
    ok.forEach((f) => fd.append("files", f))
    try {
      await uploadImages({ id: product.id, fd }).unwrap()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const move = (idx, dir) => {
    const j = idx + dir
    if (j < 0 || j >= items.length) return
    if (!product) {
      setPending((list) => {
        const next = [...list]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        return next
      })
      return
    }
    const ids = product.images.map((i) => i.id)
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    reorderImages({ id: product.id, ids })
  }
  const remove = (idx) => {
    if (!canRemove) return
    if (!product) {
      URL.revokeObjectURL(pending[idx].url)
      setPending((list) => list.filter((_, i) => i !== idx))
      return
    }
    deleteImage({ id: product.id, imageId: product.images[idx].id })
  }
  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    add(e.dataTransfer.files)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className={cn("text-base", error && "text-destructive")}>Images <span className="text-destructive" aria-hidden="true">*</span></CardTitle>
        <CardDescription>
          At least one image is required. Recommended: square <strong>1200 × 1200 px</strong>, WebP or JPEG, white or plain background,
          with the whole shoe visible. Add 4–6 images (up to {MAX_IMAGES}); the first one is the main image. JPG, PNG or WebP up to
          {" "}{MAX_IMAGE_MB} MB each are accepted and converted to compressed WebP automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-[0.8rem] font-medium text-destructive">{error}</p>}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((im, i) => (
            <div key={im.key} className="group relative aspect-square overflow-hidden rounded-md border bg-white">
              <img src={im.url} alt={`Product image ${i + 1}`} className="size-full object-contain" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" onClick={() => move(i, -1)} className="text-white" aria-label="Move left"><ArrowLeft className="size-4" /></button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={!canRemove}
                  className="text-white disabled:opacity-40"
                  aria-label="Delete image"
                  title={canRemove ? "Delete image" : "At least one image is required. Add another image first."}
                >
                  <X className="size-4" />
                </button>
                <button type="button" onClick={() => move(i, 1)} className="text-white" aria-label="Move right"><ArrowRight className="size-4" /></button>
              </div>
              {i === 0 && <span className="absolute left-1 top-1 rounded bg-primary px-1.5 text-[10px] text-primary-foreground">Main</span>}
              {saving && !product && <div className="absolute inset-0 grid place-items-center bg-background/60"><Loader2 className="size-5 animate-spin" /></div>}
            </div>
          ))}
          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "grid aspect-square cursor-pointer place-items-center rounded-md border-2 border-dashed p-2 text-center text-xs text-muted-foreground hover:bg-muted",
              error && "border-destructive text-destructive",
              dragging && "border-primary bg-primary/5",
              items.length >= MAX_IMAGES && "hidden"
            )}
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : (
              <span className="flex flex-col items-center gap-1"><ImagePlus className="size-5" /> Add images<span className="hidden sm:block">or drop here</span></span>
            )}
            <input type="file" multiple accept={IMAGE_TYPES.join(",")} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = "" }} />
          </label>
        </div>
        {!product && pending.length > 0 && (
          <p className="text-xs text-muted-foreground">These images are uploaded together with the product when you save.</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function ProductForm() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  useDocumentTitle(isNew ? "Add product" : "Edit product")
  const [v, setV] = useState(EMPTY)
  const { data: brands = [] } = useGetAdminTaxonomyQuery("brands")
  const { data: cats = [] } = useGetAdminTaxonomyQuery("categories")
  const { data: product, isLoading } = useGetAdminProductQuery(id, { skip: isNew })

  const load = (p) =>
    setV({
      ...EMPTY,
      ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, p[k] ?? EMPTY[k]])),
      // "12.00" from the API -> "12" so it matches a GST option
      gst_rate: isBlank(p.gst_rate) ? "" : String(Number(p.gst_rate)),
      variants: p.variants.map((x) => ({ ...x, price_override: x.price_override ?? "" })),
    })
  // load once per product; later cache updates (image uploads) must not wipe unsaved edits
  const [loadedId, setLoadedId] = useState(null)
  useEffect(() => {
    if (product && loadedId !== product.id) {
      setLoadedId(product.id)
      load(product)
    }
  }, [product, loadedId])

  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const setVariant = (i, k, val) => setV((s) => ({ ...s, variants: s.variants.map((x, j) => (j === i ? { ...x, [k]: val } : x)) }))

  const [saveProduct, { isLoading: saving }] = useSaveAdminProductMutation()
  const [deleteProduct] = useDeleteAdminProductMutation()
  // images picked on "Add product"; sent with the product in the same request
  const [pending, setPending] = useState([])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])
  // errors show after the first Save attempt and then update as the admin fixes them
  const [showErrors, setShowErrors] = useState(false)
  const imageCount = isNew ? pending.length : product?.images.length ?? 0
  const [generatorTyping, setGeneratorTyping] = useState(false)
  const errors = showErrors ? validate(v, imageCount, generatorTyping) : {}
  const problems = showErrors ? errorList(errors, v.variants) : []
  // overrides: e.g. { is_active: true } from the "Make active" button, applied on top of the form values
  const save = (overrides = {}) => {
    const found = validate(v, imageCount, generatorTyping)
    if (Object.keys(found).length) {
      setShowErrors(true)
      toast.error("Please fill in the required fields before saving")
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    const body = {
      ...v,
      ...overrides,
      slug: v.slug || null,
      hsn_code: v.hsn_code || null,
      material: v.material || null,
      description: v.description || null,
      care: v.care || null,
      size_chart: v.size_chart || null,
      tags: v.tags || null,
      gst_rate: Number(v.gst_rate || 0),
      mrp: Number(v.mrp),
      price: Number(v.price),
      variants: v.variants.map((x) => ({
        id: x.id || null,
        sku: x.sku,
        size: String(x.size),
        colour: x.colour,
        stock_qty: x.id ? null : Number(x.stock_qty),
        price_override: isBlank(x.price_override) ? null : Number(x.price_override),
        low_stock_threshold: isBlank(x.low_stock_threshold) ? DEFAULT_LOW_STOCK : Number(x.low_stock_threshold),
        is_active: x.is_active,
      })),
    }
    // the endpoint also writes the saved product into the getAdminProduct cache
    saveProduct(isNew ? { ...body, files: pending.map((p) => p.file) } : { id, ...body })
      .unwrap()
      .then((data) => {
        load(data)
        setShowErrors(false)
        const what = isNew ? `Product saved with ${data.images.length} image${data.images.length > 1 ? "s" : ""}` : "Product saved"
        if (data.is_active) toast.success(`${what}. It is visible in the store.`)
        else toast.warning(`${what} as a draft. It is hidden from the store until you make it active.`)
        if (isNew) navigate(`/admin/products/${data.id}`, { replace: true })
      })
      .catch((e) => toast.error(errorMessage(e)))
  }
  const del = () =>
    deleteProduct(id)
      .unwrap()
      .then((data) => {
        toast.success(data.message || "Product deleted")
        navigate("/admin/products")
      })
      .catch(() => {})

  if (!isNew && isLoading) return <PageLoader />

  return (
    <div className="space-y-6">
      <PageHeader
        title={isNew ? "Add product" : v.name || "Edit product"}
        actions={
          <>
            <Button variant="ghost" asChild><Link to="/admin/products"><ArrowLeft /> Back</Link></Button>
            {!isNew && product?.is_active && <Button variant="outline" asChild><a href={`/product/${product.slug}`} target="_blank" rel="noreferrer"><ExternalLink /> View</a></Button>}
            {!isNew && (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="outline" className="text-destructive"><Trash2 /> Delete</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this product?</AlertDialogTitle>
                    <AlertDialogDescription>Products that already have orders are moved to draft instead of being deleted.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={del}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button onClick={() => save()} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save</Button>
          </>
        }
      />

      {problems.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Please fix {problems.length === 1 ? "1 field" : `${problems.length} fields`} before saving</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-0.5 pl-4">
              {problems.slice(0, 12).map((p) => <li key={p}>{p}</li>)}
              {problems.length > 12 && <li>…and {problems.length - 12} more</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {!isNew && product && !product.is_active && (
        <Alert className="border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200 [&>svg]:text-amber-600">
          <EyeOff className="size-4" />
          <AlertTitle>This product is a draft and is hidden from the store</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Customers cannot see it in categories, search or the home page until it is active.</span>
            <Button size="sm" onClick={() => save({ is_active: true })} disabled={saving}><Eye /> Make active</Button>
          </AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">Fields marked <span className="text-destructive">*</span> are required.</p>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <F label="Name" required error={errors.name} className="sm:col-span-2"><Input value={v.name} onChange={set("name")} /></F>
            <F label="URL slug" hint="Leave empty to generate from the name"><Input value={v.slug || ""} onChange={set("slug")} /></F>
            <F label="Gender" required error={errors.gender}>
              <Select value={v.gender ?? ""} onValueChange={set("gender")}>
                <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="men">Men</SelectItem>
                  <SelectItem value="women">Women</SelectItem>
                  <SelectItem value="kids">Kids</SelectItem>
                  <SelectItem value="unisex">Unisex</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Brand" hint="Optional">
              <Select value={v.brand_id ? String(v.brand_id) : "none"} onValueChange={(x) => set("brand_id")(x === "none" ? null : Number(x))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No brand</SelectItem>
                  {brands.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Category" required error={errors.category_id}>
              <Select value={v.category_id ? String(v.category_id) : ""} onValueChange={(x) => set("category_id")(Number(x))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {cats.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Description" className="sm:col-span-2"><Textarea rows={4} value={v.description || ""} onChange={set("description")} /></F>
            <F label="Material"><Input value={v.material || ""} onChange={set("material")} /></F>
            <F label="Tags" hint="Comma separated, used in search"><Input value={v.tags || ""} onChange={set("tags")} /></F>
            <F label="Care instructions" className="sm:col-span-2"><Textarea rows={2} value={v.care || ""} onChange={set("care")} /></F>
            <F label="Size chart" className="sm:col-span-2" hint="Plain text table, e.g. UK 6 = 24.5 cm"><Textarea rows={3} className="font-mono" value={v.size_chart || ""} onChange={set("size_chart")} /></F>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Pricing & tax</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <F label="MRP (₹)" required error={errors.mrp}><Input type="number" min={0} step="0.01" value={v.mrp} onChange={set("mrp")} /></F>
              <F label="Selling price (₹, GST inclusive)" required error={errors.price} hint="Cannot be more than MRP">
                <Input type="number" min={0} step="0.01" value={v.price} onChange={set("price")} />
              </F>
              <F label="HSN code" required error={errors.hsn_code} hint="4 to 8 digits, printed on the GST invoice">
                <Input value={v.hsn_code || ""} onChange={(e) => set("hsn_code")(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={8} />
              </F>
              <F label="GST %" required error={errors.gst_rate}>
                <Select value={isBlank(v.gst_rate) ? "" : String(v.gst_rate)} onValueChange={set("gst_rate")}>
                  <SelectTrigger><SelectValue placeholder="Select GST rate" /></SelectTrigger>
                  <SelectContent>
                    {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                  </SelectContent>
                </Select>
              </F>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Visibility</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between">
              <Label htmlFor="active">{v.is_active ? "Active – visible in store" : "Draft – hidden from store"}</Label>
              <Switch id="active" checked={v.is_active} onCheckedChange={set("is_active")} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variants (size × colour) <span className="text-destructive" aria-hidden="true">*</span></CardTitle>
          <CardDescription>
            At least one variant is required. SKU, size, colour and stock are required for each; price override and low-stock level are optional
            (low-stock defaults to {DEFAULT_LOW_STOCK}). After saving, change stock from Inventory (every change is logged with a reason).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errors.variants && <p className="text-[0.8rem] font-medium text-destructive">{errors.variants}</p>}
          <VariantGenerator
            base={v.slug || v.name}
            onAdd={(rows) => setV((s) => ({ ...s, variants: [...s.variants, ...rows] }))}
            onTypingChange={setGeneratorTyping}
          />
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU <span className="text-destructive">*</span></TableHead>
                  <TableHead>Size <span className="text-destructive">*</span></TableHead>
                  <TableHead>Colour <span className="text-destructive">*</span></TableHead>
                  <TableHead>Stock <span className="text-destructive">*</span></TableHead>
                  <TableHead>Price override (₹)</TableHead>
                  <TableHead>Low-stock at</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.variants.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="h-16 text-center text-muted-foreground">No variants yet. Use the generator above or add a row.</TableCell></TableRow>
                )}
                {v.variants.map((x, i) => (
                  <TableRow key={x.id ?? `new-${i}`}>
                    <TableCell><Input className={cn("h-8 min-w-36", cellError(errors[`v.${i}.sku`]))} aria-invalid={!!errors[`v.${i}.sku`]} title={errors[`v.${i}.sku`]} aria-label="SKU" value={x.sku} onChange={(e) => setVariant(i, "sku", e.target.value.toUpperCase())} /></TableCell>
                    <TableCell><Input className={cn("h-8 w-16", cellError(errors[`v.${i}.size`]))} aria-invalid={!!errors[`v.${i}.size`]} title={errors[`v.${i}.size`]} aria-label="Size" value={x.size} onChange={(e) => setVariant(i, "size", e.target.value)} /></TableCell>
                    <TableCell><Input className={cn("h-8 w-28", cellError(errors[`v.${i}.colour`]))} aria-invalid={!!errors[`v.${i}.colour`]} title={errors[`v.${i}.colour`]} aria-label="Colour" value={x.colour} onChange={(e) => setVariant(i, "colour", e.target.value)} /></TableCell>
                    <TableCell>
                      {x.id ? <span className="px-2 font-medium">{x.stock_qty}</span> : (
                        <Input className={cn("h-8 w-20", cellError(errors[`v.${i}.stock_qty`]))} aria-invalid={!!errors[`v.${i}.stock_qty`]} title={errors[`v.${i}.stock_qty`]} type="number" min={0} step={1} value={x.stock_qty} onChange={(e) => setVariant(i, "stock_qty", e.target.value)} aria-label="Opening stock" />
                      )}
                    </TableCell>
                    <TableCell><Input className={cn("h-8 w-24", cellError(errors[`v.${i}.price_override`]))} aria-invalid={!!errors[`v.${i}.price_override`]} title={errors[`v.${i}.price_override`]} aria-label="Price override" type="number" min={0} step="0.01" placeholder="—" value={x.price_override} onChange={(e) => setVariant(i, "price_override", e.target.value)} /></TableCell>
                    <TableCell><Input className={cn("h-8 w-16", cellError(errors[`v.${i}.low_stock_threshold`]))} aria-invalid={!!errors[`v.${i}.low_stock_threshold`]} title={errors[`v.${i}.low_stock_threshold`]} aria-label="Low-stock at" type="number" min={0} step={1} placeholder={String(DEFAULT_LOW_STOCK)} value={x.low_stock_threshold} onChange={(e) => setVariant(i, "low_stock_threshold", e.target.value)} /></TableCell>
                    <TableCell><Switch checked={x.is_active} onCheckedChange={(c) => setVariant(i, "is_active", c)} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setV((s) => ({ ...s, variants: s.variants.filter((_, j) => j !== i) }))} aria-label="Remove variant">
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button variant="outline" size="sm" onClick={() => setV((s) => ({ ...s, variants: [...s.variants, { sku: "", size: "", colour: "", stock_qty: 0, price_override: "", low_stock_threshold: 3, is_active: true }] }))}>
            <Plus /> Add row
          </Button>
        </CardContent>
      </Card>

      {isNew ? (
        <Images pending={pending} setPending={setPending} saving={saving} error={errors.images} />
      ) : (
        product && <Images product={product} error={errors.images} />
      )}
    </div>
  )
}
