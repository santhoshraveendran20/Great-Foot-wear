import { useEffect, useMemo, useState } from "react"
import { Loader2, MapPin, PackageX, ShoppingBag, Star, Truck, Zap } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { DealPrice, EmptyState, PageLoader, ProductImage, RatingStars, useDocumentTitle } from "@/components/common"
import { DeliveryNote, ProductGrid } from "@/components/store/ProductCard"
import { useStoreSettings } from "@/components/store/StoreLayout"
import { WishlistButton } from "@/components/store/WishlistButton"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import { errorMessage } from "@/lib/api"
import { cn, formatDate } from "@/lib/utils"
import {
  useGetCatalogProductQuery,
  useGetProductCanReviewQuery,
  useGetProductReviewsQuery,
  useSubmitProductReviewMutation,
} from "@/store/api/catalogApi"
import { useLazyCheckPincodeQuery } from "@/store/api/commonApi"

const RECENT_KEY = "gfw_recently_viewed"

function useRecentlyViewed(product) {
  const [recent, setRecent] = useState([])
  useEffect(() => {
    if (!product) return
    let list = []
    try {
      list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]")
    } catch { /* ignore */ }
    setRecent(list.filter((p) => p.id !== product.id).slice(0, 8))
    const card = {
      id: product.id, name: product.name, slug: product.slug, brand: product.brand, image: product.image, price: product.price,
      mrp: product.mrp, discount_pct: product.discount_pct, rating_avg: product.rating_avg, rating_count: product.rating_count, in_stock: product.in_stock,
    }
    localStorage.setItem(RECENT_KEY, JSON.stringify([card, ...list.filter((p) => p.id !== product.id)].slice(0, 12)))
  }, [product])
  return recent
}

function Gallery({ images, name }) {
  const [active, setActive] = useState(0)
  const [zoom, setZoom] = useState(null)
  const img = images[active]
  return (
    <div className="flex flex-col-reverse gap-3 md:flex-row lg:sticky lg:top-24">
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar md:w-16 md:flex-col">
          {images.map((im, i) => (
            <button
              key={im.id}
              onClick={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              className={cn("aspect-square w-14 shrink-0 overflow-hidden rounded-md border-2 bg-white md:w-full", i === active ? "border-primary" : "border-border")}
              aria-label={`Show image ${i + 1}`}
              aria-pressed={i === active}
            >
              <img src={im.url} alt="" className="size-full object-contain" />
            </button>
          ))}
        </div>
      )}
      <div
        className="relative aspect-square flex-1 cursor-zoom-in overflow-hidden rounded-lg border bg-white"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
        }}
        onMouseLeave={() => setZoom(null)}
      >
        {img ? (
          <img
            src={img.url}
            alt={`${name} – image ${active + 1}`}
            className="size-full object-contain transition-transform duration-150"
            style={zoom ? { transform: "scale(2)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
          />
        ) : (
          <ProductImage alt={name} />
        )}
      </div>
    </div>
  )
}

function PincodeCheck() {
  const [pin, setPin] = useState(() => localStorage.getItem("gfw_pincode") || "")
  const [checkPincode, check] = useLazyCheckPincodeQuery()
  const runCheck = (code) =>
    checkPincode({ pincode: code })
      .unwrap()
      .then(() => localStorage.setItem("gfw_pincode", code))
      .catch(() => {}) // shown below from check.error
  // currentData: only the result for the PIN code checked last
  const r = check.currentData
  return (
    <div className="space-y-2">
      <Label htmlFor="pincode" className="flex items-center gap-2"><MapPin className="size-4" /> Check delivery</Label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (/^[1-9]\d{5}$/.test(pin)) runCheck(pin)
          else toast.error("Enter a valid 6-digit PIN code")
        }}
      >
        <Input id="pincode" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Enter PIN code" className="max-w-40" />
        <Button type="submit" variant="outline" disabled={check.isFetching}>Check</Button>
      </form>
      {check.isError && <p className="text-sm text-destructive">{errorMessage(check.error)}</p>}
      {r && (
        <div className="space-y-1 text-sm">
          {r.serviceable ? (
            <>
              <p className="flex items-center gap-2"><Truck className="size-4 text-primary" /> Delivery by {formatDate(r.estimated_delivery_from)} – {formatDate(r.estimated_delivery_to)}</p>
              <p className={r.cod_available ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                {r.cod_available ? "Cash on Delivery available" : "Cash on Delivery not available"}
              </p>
            </>
          ) : (
            <p className="text-destructive">Sorry, we do not deliver to this PIN code yet.</p>
          )}
          {r.pickup_available && <p className="text-muted-foreground">Store pickup available at Manali.</p>}
        </div>
      )}
    </div>
  )
}

function Reviews({ product }) {
  const { user } = useAuth()
  // currentData: don't show the previous product's reviews while another product loads
  const { currentData: reviews = [] } = useGetProductReviewsQuery(product.slug)
  const { currentData: can } = useGetProductCanReviewQuery(product.slug, { skip: user?.role !== "customer" })
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  // refreshes can-review for this product (invalidatesTags)
  const [submitReview, { isLoading: submitting }] = useSubmitProductReviewMutation()
  const submit = () =>
    submitReview({ slug: product.slug, rating, comment: comment || null })
      .unwrap()
      .then((r) => {
        toast.success(r.message)
        setRating(0)
        setComment("")
      })
      .catch((e) => toast.error(errorMessage(e)))

  return (
    <section className="space-y-5" aria-labelledby="reviews-heading">
      <div className="flex items-center gap-3">
        <h2 id="reviews-heading" className="font-serif text-xl font-bold">Ratings & reviews</h2>
        {product.rating_count > 0 && <RatingStars value={product.rating_avg} count={product.rating_count} />}
      </div>
      {can?.eligible && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">{can.existing ? "Update your review" : "Write a review"}</p>
          <div className="flex gap-1" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={`${i} star`} onClick={() => setRating(i)}>
                <Star className={cn("size-6", i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
              </button>
            ))}
          </div>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your experience (optional)" maxLength={2000} />
          <Button onClick={submit} disabled={!rating || submitting}>Submit review</Button>
          <p className="text-xs text-muted-foreground">Only customers who received this product can review it. Reviews appear after moderation.</p>
        </div>
      )}
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet.</p>
      ) : (
        <ul className="divide-y">
          {reviews.map((r) => (
            <li key={r.id} className="space-y-1 py-4">
              <div className="flex items-center gap-2">
                <RatingStars value={r.rating} />
                <span className="text-sm font-medium">{r.user_name}</span>
                <span className="text-xs text-muted-foreground">· {formatDate(r.created_at)}</span>
              </div>
              {r.comment && <p className="text-sm">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function ProductDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { add, cart } = useCart()
  const { user } = useAuth()
  const { data: settings } = useStoreSettings()
  // currentData: show the loader, not the previous product, when moving to another product
  const { currentData: p, isFetching, isError } = useGetCatalogProductQuery(slug)
  useDocumentTitle(p?.name, p ? `${p.name}${p.brand ? ` by ${p.brand}` : ""} – ${p.description?.slice(0, 140) || "Buy online at Great Foot Wear."}` : undefined)
  const recent = useRecentlyViewed(p)

  const colours = useMemo(() => [...new Set(p?.variants.map((v) => v.colour) ?? [])], [p])
  const [colour, setColour] = useState(null)
  const [variantId, setVariantId] = useState(null)
  const [qty, setQty] = useState(1)
  const [adding, setAdding] = useState(false)

  // when a colour has exactly one size in stock it is picked automatically (nothing to choose)
  const onlySizeId = (c) => {
    const inStock = p?.variants.filter((v) => v.colour === c && v.in_stock) ?? []
    return inStock.length === 1 ? inStock[0].id : null
  }
  const pickColour = (c) => {
    setColour(c)
    setVariantId(onlySizeId(c))
    setQty(1)
  }

  useEffect(() => {
    if (!p) return
    const firstInStock = p.variants.find((v) => v.in_stock)
    pickColour(firstInStock?.colour ?? colours[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, colours])

  if (isFetching && !p) return <PageLoader />
  if (isError || !p) {
    return (
      <div className="container py-10">
        <EmptyState icon={PackageX} title="Product not found" description="It may have been removed or is no longer available." action={<Button asChild><Link to="/">Continue shopping</Link></Button>} />
      </div>
    )
  }

  const sizes = p.variants.filter((v) => v.colour === colour)
  const variant = p.variants.find((v) => v.id === variantId)
  const price = variant?.price ?? p.price
  // % off for the price shown (a size can have its own price override)
  const discount = Number(p.mrp) > Number(price) ? Math.round((1 - Number(price) / Number(p.mrp)) * 100) : 0
  const isStaff = user && user.role !== "customer"

  const addToCart = async (buyNow = false) => {
    if (!variant) {
      toast.error("Please select a size")
      return
    }
    setAdding(true)
    try {
      if (buyNow) {
        // Buy now goes straight to checkout; the item is added only if it is not in the cart already,
        // so pressing Add to cart and then Buy now does not double the quantity.
        // (Guests are asked to log in first and come back to checkout with their cart merged.)
        if (!cart?.items?.some((i) => i.variant_id === variant.id)) await add(variant.id, qty)
        navigate("/checkout")
        return
      }
      await add(variant.id, qty)
      toast.success("Added to cart", { action: { label: "View cart", onClick: () => navigate("/cart") } })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setAdding(false)
    }
  }

  const stockNote = !p.in_stock
    ? <p className="text-lg font-medium text-destructive">Currently out of stock</p>
    : variant && variant.max_qty <= 3
      ? <p className="text-lg font-medium text-amber-700 dark:text-amber-400">Only {variant.max_qty} left in stock</p>
      : <p className="text-lg font-medium text-emerald-700 dark:text-emerald-400">In stock</p>

  return (
    <div className="container py-6">
      <nav aria-label="Breadcrumb" className="mb-4 text-xs text-muted-foreground">
        <Link to="/" className="hover:underline">Home</Link>
        {p.category && <> <span aria-hidden="true">›</span> <Link to={`/category/${p.category_slug}`} className="hover:underline">{p.category}</Link></>}
        <span aria-hidden="true"> › </span><span className="text-foreground">{p.name}</span>
      </nav>

      {/* gallery | details | buy box (stacks on smaller screens) */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
        <div><Gallery images={p.images} name={p.name} /></div>

        <div className="space-y-5">
          <div className="space-y-1.5">
            {p.brand && (
              <Link to={`/search?q=${encodeURIComponent(p.brand)}`} className="text-sm font-medium text-primary hover:underline">
                Visit the {p.brand} collection
              </Link>
            )}
            <h1 className="text-xl font-semibold leading-snug md:text-2xl">{p.name}</h1>
            {p.rating_count > 0 ? (
              <a href="#reviews-heading" className="inline-flex items-center gap-2 text-sm hover:underline">
                <span className="font-medium">{Number(p.rating_avg).toFixed(1)}</span>
                <RatingStars value={p.rating_avg} count={p.rating_count} />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No ratings yet</p>
            )}
          </div>
          <Separator />
          <div className="space-y-1">
            <DealPrice price={price} mrp={p.mrp} discount={discount} size="lg" />
            <p className="text-sm text-muted-foreground">Inclusive of all taxes</p>
          </div>
          <Separator />

          {colours.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Colour: <span className="font-normal">{colour}</span></p>
              <div className="flex flex-wrap gap-2">
                {colours.map((c) => (
                  <Button key={c} variant={c === colour ? "default" : "outline"} size="sm" onClick={() => pickColour(c)} aria-pressed={c === colour}>
                    {c}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Size (UK/IND)</p>
              {p.size_chart && <a href="#size-chart" className="text-sm text-primary hover:underline">Size chart</a>}
            </div>
            <div className="flex flex-wrap gap-2">
              {sizes.map((v) => (
                <Button
                  key={v.id}
                  variant={v.id === variantId ? "default" : "outline"}
                  className={cn("min-w-12", !v.in_stock && "line-through")}
                  disabled={!v.in_stock}
                  onClick={() => { setVariantId(v.id); setQty(1) }}
                  aria-pressed={v.id === variantId}
                  aria-label={`Size ${v.size}${v.in_stock ? "" : ", out of stock"}`}
                >
                  {v.size}
                </Button>
              ))}
            </div>
            {!p.in_stock && <Alert><AlertDescription>This product is currently out of stock.</AlertDescription></Alert>}
          </div>

          {(p.brand || p.material || p.gender || p.category) && (
            <div className="space-y-2">
              <h2 className="text-base font-semibold">Product details</h2>
              <dl className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-4 gap-y-1.5 text-sm">
                {p.brand && <><dt className="font-medium">Brand</dt><dd>{p.brand}</dd></>}
                {p.material && <><dt className="font-medium">Material</dt><dd>{p.material}</dd></>}
                {p.category && <><dt className="font-medium">Category</dt><dd>{p.category}</dd></>}
                {p.gender && <><dt className="font-medium">Gender</dt><dd className="capitalize">{p.gender}</dd></>}
                {colours.length > 0 && <><dt className="font-medium">Colours</dt><dd>{colours.join(", ")}</dd></>}
              </dl>
            </div>
          )}

          <Accordion type="multiple" defaultValue={["description"]}>
            {p.description && (
              <AccordionItem value="description">
                <AccordionTrigger>Description</AccordionTrigger>
                <AccordionContent className="whitespace-pre-line text-sm text-muted-foreground">{p.description}</AccordionContent>
              </AccordionItem>
            )}
            {p.care && (
              <AccordionItem value="care">
                <AccordionTrigger>Care instructions</AccordionTrigger>
                <AccordionContent className="whitespace-pre-line text-sm text-muted-foreground">{p.care}</AccordionContent>
              </AccordionItem>
            )}
            {p.size_chart && (
              <AccordionItem value="size-chart" id="size-chart">
                <AccordionTrigger>Size chart</AccordionTrigger>
                <AccordionContent className="whitespace-pre-line font-mono text-sm text-muted-foreground">{p.size_chart}</AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>

        {/* buy box */}
        <aside aria-label="Buy" className="h-fit space-y-4 rounded-lg border p-4 lg:sticky lg:top-24">
          <DealPrice price={price} mrp={p.mrp} discount={discount} />
          <DeliveryNote price={price} className="text-sm" />
          <PincodeCheck />
          {stockNote}

          {!isStaff && (
            <>
              {variant ? (
                <div className="flex items-center gap-3">
                  <Label htmlFor="qty" className="text-sm font-semibold">Quantity</Label>
                  <select id="qty" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="h-9 rounded-md border bg-background px-3 text-sm">
                    {Array.from({ length: variant.max_qty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              ) : (
                p.in_stock && <p className="text-sm text-muted-foreground">Select a size to continue.</p>
              )}
              <div className="grid gap-2">
                <Button size="lg" className="w-full rounded-full" onClick={() => addToCart(false)} disabled={adding || !p.in_stock}>
                  {adding ? <Loader2 className="animate-spin" /> : <ShoppingBag />} Add to cart
                </Button>
                <Button size="lg" variant="secondary" className="w-full rounded-full" onClick={() => addToCart(true)} disabled={adding || !p.in_stock}>
                  <Zap /> Buy now
                </Button>
                <WishlistButton productId={p.id} withLabel className="w-full rounded-full" />
              </div>
            </>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
            <dt className="text-muted-foreground">Ships from</dt><dd>Great Foot Wear, Manali</dd>
            <dt className="text-muted-foreground">Sold by</dt><dd>Great Foot Wear</dd>
            {settings?.return_window_days > 0 && <><dt className="text-muted-foreground">Returns</dt><dd>{settings.return_window_days}-day return / size exchange</dd></>}
          </dl>
        </aside>
      </div>

      <Separator className="my-10" />
      <Reviews product={p} />

      {p.similar?.length > 0 && (
        <section className="mt-12 space-y-5">
          <h2 className="font-serif text-xl font-bold">Similar products</h2>
          <ProductGrid products={p.similar.slice(0, 4)} />
        </section>
      )}
      {recent.length > 0 && (
        <section className="mt-12 space-y-5">
          <h2 className="font-serif text-xl font-bold">Recently viewed</h2>
          <ProductGrid products={recent.slice(0, 4)} />
        </section>
      )}
    </div>
  )
}
