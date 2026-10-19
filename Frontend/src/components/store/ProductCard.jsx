import { useEffect, useMemo, useState } from "react"
import { Loader2, ShoppingCart, Truck } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { DealPrice, ProductImage, RatingStars } from "@/components/common"
import { useStoreSettings } from "@/components/store/StoreLayout"
import { WishlistButton } from "@/components/store/WishlistButton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { errorMessage } from "@/lib/api"
import { cn, formatINR } from "@/lib/utils"
import { useGetCatalogProductQuery } from "@/store/api/catalogApi"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"

/** "FREE delivery" only when the shipping rules really make this item free on its own (see pricing.py). */
export function DeliveryNote({ price, className }) {
  const { data: settings } = useStoreSettings()
  const shipping = settings?.shipping
  if (!shipping) return null
  const fee = Number(shipping.flat_fee || 0)
  const threshold = shipping.free_shipping_threshold != null ? Number(shipping.free_shipping_threshold) : null
  const free = fee === 0 || (threshold !== null && Number(price) >= threshold)
  if (!free && threshold === null) return null
  return (
    <p className={cn("flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <Truck className="size-3.5 shrink-0" />
      {free ? <span><strong className="text-foreground">FREE delivery</strong></span> : <span>FREE delivery on orders above {formatINR(threshold)}</span>}
    </p>
  )
}

/** Size (and colour) picker opened from a product card's "Add to cart". */
function QuickAddDialog({ product, open, onOpenChange }) {
  const navigate = useNavigate()
  const { add } = useCart()
  const { currentData: p, isFetching } = useGetCatalogProductQuery(product.slug, { skip: !open })
  const colours = useMemo(() => [...new Set(p?.variants.map((v) => v.colour) ?? [])], [p])
  const [colour, setColour] = useState(null)
  const [variantId, setVariantId] = useState(null)
  const [adding, setAdding] = useState(false)

  // a colour with exactly one size in stock gets that size picked automatically
  const pickColour = (c) => {
    const inStock = p?.variants.filter((v) => v.colour === c && v.in_stock) ?? []
    setColour(c)
    setVariantId(inStock.length === 1 ? inStock[0].id : null)
  }

  useEffect(() => {
    if (!p || !open) return
    pickColour(p.variants.find((v) => v.in_stock)?.colour ?? colours[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, open, colours])

  const sizes = p?.variants.filter((v) => v.colour === colour) ?? []
  const variant = p?.variants.find((v) => v.id === variantId)

  const addToCart = async () => {
    if (!variant) return toast.error("Please select a size")
    setAdding(true)
    try {
      await add(variant.id, 1)
      onOpenChange(false)
      toast.success("Added to cart", { action: { label: "View cart", onClick: () => navigate("/cart") } })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="line-clamp-2 pr-6">{product.name}</DialogTitle>
          <DialogDescription>Choose {colours.length > 1 ? "a colour and " : ""}your size.</DialogDescription>
        </DialogHeader>
        {!p ? (
          <div className="grid h-32 place-items-center">{isFetching && <Loader2 className="size-5 animate-spin text-muted-foreground" />}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="size-20 shrink-0 overflow-hidden rounded-md border bg-white">
                <ProductImage src={p.image} alt="" className="object-contain" />
              </div>
              <DealPrice price={variant?.price ?? p.price} mrp={p.mrp} discount={p.discount_pct} />
            </div>
            {colours.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Colour: <span className="font-normal">{colour}</span></p>
                <div className="flex flex-wrap gap-2">
                  {colours.map((c) => (
                    <Button key={c} size="sm" variant={c === colour ? "default" : "outline"} aria-pressed={c === colour} onClick={() => pickColour(c)}>{c}</Button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <p className="text-sm font-semibold">Size (UK/IND)</p>
              <div className="flex flex-wrap gap-2">
                {sizes.map((v) => (
                  <Button
                    key={v.id}
                    variant={v.id === variantId ? "default" : "outline"}
                    className={cn("min-w-12", !v.in_stock && "line-through")}
                    disabled={!v.in_stock}
                    aria-pressed={v.id === variantId}
                    aria-label={`Size ${v.size}${v.in_stock ? "" : ", out of stock"}`}
                    onClick={() => setVariantId(v.id)}
                  >
                    {v.size}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={addToCart} disabled={adding || !variant}>
                {adding ? <Loader2 className="animate-spin" /> : <ShoppingCart />} Add to cart
              </Button>
              <Button variant="outline" asChild><Link to={`/product/${p.slug}`} onClick={() => onOpenChange(false)}>View details</Link></Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ProductCard({ product }) {
  const { user } = useAuth()
  const isStaff = user && user.role !== "customer"
  const [quickAdd, setQuickAdd] = useState(false)
  const href = `/product/${product.slug}`
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      {/* light ground and object-contain so the whole shoe is visible, as the image guidelines ask */}
      <Link to={href} className="relative block aspect-square overflow-hidden bg-zinc-50 dark:bg-zinc-100">
        <ProductImage src={product.image} alt={product.name} className="object-contain p-3 transition-transform duration-300 group-hover:scale-105" />
        {!product.in_stock && <Badge variant="secondary" className="absolute left-2 top-2">Out of stock</Badge>}
      </Link>
      <WishlistButton productId={product.id} className="absolute right-2 top-2" />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link to={href} className="space-y-0.5 hover:text-primary">
          {product.brand && <span className="block text-sm font-semibold text-foreground">{product.brand}</span>}
          <span className="line-clamp-2 text-sm">{product.name}</span>
        </Link>
        {product.rating_count > 0 && <RatingStars value={product.rating_avg} count={product.rating_count} />}
        <DealPrice price={product.price} mrp={product.mrp} discount={product.discount_pct} className="mt-1" />
        <DeliveryNote price={product.price} />
        {!isStaff && (
          <div className="mt-auto pt-2">
            {product.in_stock ? (
              <Button size="sm" className="w-full rounded-full" onClick={() => setQuickAdd(true)}>Add to cart</Button>
            ) : (
              <Button size="sm" variant="outline" className="w-full rounded-full" asChild><Link to={href}>See details</Link></Button>
            )}
          </div>
        )}
      </div>
      {quickAdd && <QuickAddDialog product={product} open={quickAdd} onOpenChange={setQuickAdd} />}
    </div>
  )
}

export function ProductGrid({ products }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  )
}
