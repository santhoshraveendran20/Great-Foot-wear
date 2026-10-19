import { useMemo } from "react"
import { SearchX, SlidersHorizontal } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"

import { EmptyState, PageLoader, useDocumentTitle } from "@/components/common"
import { ProductGrid } from "@/components/store/ProductCard"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useGetCatalogProductsQuery } from "@/store/api/catalogApi"

const SORTS = [
  { value: "popularity", label: "Popularity" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "discount", label: "Discount" },
]
const MULTI = ["brand", "size", "colour", "gender", "material"]
const GENDER_LABEL = { men: "Men", women: "Women", kids: "Kids", unisex: "Unisex" }

function FilterGroup({ title, children }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

function Filters({ facets, params, setParams }) {
  const toggle = (key, value) => {
    const next = new URLSearchParams(params)
    const values = next.getAll(key)
    next.delete(key)
    const updated = values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
    updated.forEach((v) => next.append(key, v))
    next.delete("page")
    setParams(next)
  }
  const setOne = (key, value) => {
    const next = new URLSearchParams(params)
    if (value === "" || value === null || value === undefined) next.delete(key)
    else next.set(key, value)
    next.delete("page")
    setParams(next)
  }
  const checkList = (key, items, label = (x) => x) => (
    <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
      {items.map((item) => {
        const value = typeof item === "string" ? item : item.slug
        const id = `${key}-${value}`
        return (
          <div key={value} className="flex items-center gap-2">
            <Checkbox id={id} checked={params.getAll(key).includes(value)} onCheckedChange={() => toggle(key, value)} />
            <Label htmlFor={id} className="cursor-pointer font-normal">{typeof item === "string" ? label(item) : item.name}</Label>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-6">
      {facets.genders?.length > 0 && <FilterGroup title="Gender">{checkList("gender", facets.genders, (g) => GENDER_LABEL[g] || g)}</FilterGroup>}
      {facets.brands?.length > 0 && <FilterGroup title="Brand">{checkList("brand", facets.brands)}</FilterGroup>}
      {facets.sizes?.length > 0 && (
        <FilterGroup title="Size (UK/IND)">
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((s) => {
              const active = params.getAll("size").includes(s)
              return (
                <Button key={s} type="button" size="sm" variant={active ? "default" : "outline"} className="min-w-10" onClick={() => toggle("size", s)} aria-pressed={active}>
                  {s}
                </Button>
              )
            })}
          </div>
        </FilterGroup>
      )}
      {facets.colours?.length > 0 && <FilterGroup title="Colour">{checkList("colour", facets.colours)}</FilterGroup>}
      <FilterGroup title="Price (₹)">
        <div className="flex items-center gap-2">
          <Input type="number" min={0} placeholder={facets.price?.min ? String(Math.floor(facets.price.min)) : "Min"} defaultValue={params.get("price_min") || ""}
            onBlur={(e) => setOne("price_min", e.target.value)} aria-label="Minimum price" />
          <span className="text-muted-foreground">–</span>
          <Input type="number" min={0} placeholder={facets.price?.max ? String(Math.ceil(facets.price.max)) : "Max"} defaultValue={params.get("price_max") || ""}
            onBlur={(e) => setOne("price_max", e.target.value)} aria-label="Maximum price" />
        </div>
      </FilterGroup>
      {facets.materials?.length > 0 && <FilterGroup title="Material">{checkList("material", facets.materials)}</FilterGroup>}
      <FilterGroup title="Discount">
        <RadioGroup value={params.get("discount_min") || ""} onValueChange={(v) => setOne("discount_min", v)}>
          {["10", "20", "30", "40", "50"].map((d) => (
            <div key={d} className="flex items-center gap-2">
              <RadioGroupItem value={d} id={`disc-${d}`} />
              <Label htmlFor={`disc-${d}`} className="font-normal">{d}% or more</Label>
            </div>
          ))}
        </RadioGroup>
      </FilterGroup>
      <FilterGroup title="Customer rating">
        <RadioGroup value={params.get("rating_min") || ""} onValueChange={(v) => setOne("rating_min", v)}>
          {["4", "3"].map((r) => (
            <div key={r} className="flex items-center gap-2">
              <RadioGroupItem value={r} id={`rating-${r}`} />
              <Label htmlFor={`rating-${r}`} className="font-normal">{r}★ & above</Label>
            </div>
          ))}
        </RadioGroup>
      </FilterGroup>
    </div>
  )
}

export default function Listing() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const q = params.get("q")
  const page = Number(params.get("page") || 1)
  const sort = params.get("sort") || (q ? "relevance" : "popularity")

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (slug) p.set("category", slug)
    if (q) p.set("q", q)
    for (const key of MULTI) params.getAll(key).forEach((v) => p.append(key, v))
    for (const key of ["price_min", "price_max", "discount_min", "rating_min"]) if (params.get(key)) p.set(key, params.get(key))
    p.set("sort", sort)
    p.set("page", String(page))
    return p
  }, [slug, q, params, sort, page])

  // `data` keeps the previous results while new filters load
  const { data, isLoading, isError } = useGetCatalogProductsQuery(query.toString())

  const title = data?.category?.name || (q ? `Results for “${q}”` : "All products")
  useDocumentTitle(data?.category?.name || (q ? `Search: ${q}` : "Shop"), data?.category ? `Shop ${data.category.name} footwear at Great Foot Wear.` : undefined)

  const setPage = (n) => {
    const next = new URLSearchParams(params)
    next.set("page", String(n))
    setParams(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const setSort = (v) => {
    const next = new URLSearchParams(params)
    next.set("sort", v)
    next.delete("page")
    setParams(next)
  }
  const activeFilters = [...MULTI, "price_min", "price_max", "discount_min", "rating_min"].some((k) => params.get(k))
  const clearFilters = () => {
    const next = new URLSearchParams()
    if (q) next.set("q", q)
    setParams(next)
  }

  if (isError) return <div className="container py-10"><EmptyState icon={SearchX} title="Category not found" action={<Button asChild><Link to="/">Go home</Link></Button>} /></div>
  if (isLoading && !data) return <PageLoader />

  const filters = <Filters facets={data.facets} params={params} setParams={setParams} />
  const sorts = q ? [{ value: "relevance", label: "Relevance" }, ...SORTS] : SORTS

  return (
    <div className="container py-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Home</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold md:text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{data.total} {data.total === 1 ? "product" : "products"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="lg:hidden"><SlidersHorizontal /> Filters</Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 overflow-y-auto">
              <SheetHeader><SheetTitle className="text-left">Filters</SheetTitle></SheetHeader>
              <div className="mt-6">{filters}</div>
            </SheetContent>
          </Sheet>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-48" aria-label="Sort by"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sorts.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-32 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Filters</h2>
              {activeFilters && <Button variant="link" size="sm" className="h-auto p-0" onClick={clearFilters}>Clear all</Button>}
            </div>
            <Separator />
            {filters}
          </div>
        </aside>
        <div>
          {data.items.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No products found"
              description="Try a different search or remove some filters."
              action={activeFilters ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : null}
            />
          ) : (
            <>
              <ProductGrid products={data.items} />
              {data.pages > 1 && (
                <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
                  <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  <span className="px-3 text-sm text-muted-foreground">Page {page} of {data.pages}</span>
                  <Button variant="outline" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
