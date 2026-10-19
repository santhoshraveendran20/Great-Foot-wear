import { useState } from "react"
import { Heart, ShoppingBag, Tag, Trash2, X } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { EmptyState, PageLoader, Price, ProductImage, useDocumentTitle } from "@/components/common"
import { PriceSummary } from "@/components/store/PriceSummary"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import { errorMessage } from "@/lib/api"
import {
  useApplyCouponMutation,
  useMoveCartItemToWishlistMutation,
  useRemoveCartItemMutation,
  useRemoveCouponMutation,
  useUpdateCartItemMutation,
} from "@/store/api/cartApi"

function CouponBox({ summary }) {
  const [code, setCode] = useState("")
  // cart mutations write the returned cart into the cache themselves
  const [applyCoupon, applyState] = useApplyCouponMutation()
  const [removeCoupon] = useRemoveCouponMutation()
  const apply = () =>
    applyCoupon(code.trim())
      .unwrap()
      .then(() => {
        setCode("")
        toast.success("Coupon applied")
      })
      .catch((e) => toast.error(errorMessage(e)))
  if (summary?.coupon_code) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-sm">
        <span className="flex items-center gap-2"><Tag className="size-4 text-emerald-700 dark:text-emerald-400" /> <strong>{summary.coupon_code}</strong> applied</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => removeCoupon()} aria-label="Remove coupon"><X /></Button>
      </div>
    )
  }
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) apply() }}>
      <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code" />
      <Button type="submit" variant="outline" disabled={applyState.isLoading}>Apply</Button>
    </form>
  )
}

export default function Cart() {
  useDocumentTitle("Cart")
  const { cart, loading, isGuest, setGuestQty, removeGuest } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()

  // these update the cart cache; moving to the wishlist also refreshes the wishlist ids
  const [updateItem] = useUpdateCartItemMutation()
  const [removeItem] = useRemoveCartItemMutation()
  const [moveToWishlist] = useMoveCartItemToWishlistMutation()
  const update = (arg) => updateItem(arg).unwrap().catch((e) => toast.error(errorMessage(e)))
  const toWishlist = (id) =>
    moveToWishlist(id)
      .unwrap()
      .then(() => toast.success("Moved to wishlist"))
      .catch(() => {})
  if (user && user.role !== "customer") {
    return <div className="container py-10"><EmptyState icon={ShoppingBag} title="Cart is for customer accounts" description="You are logged in as staff." /></div>
  }
  if (loading) return <PageLoader />
  const items = cart?.items ?? []
  if (!items.length) {
    return (
      <div className="container py-10">
        <EmptyState icon={ShoppingBag} title="Your cart is empty" description="Browse our collection and add your favourite pairs." action={<Button asChild><Link to="/">Start shopping</Link></Button>} />
      </div>
    )
  }
  const hasIssue = items.some((i) => i.stock_issue)

  return (
    <div className="container py-6">
      <h1 className="mb-6 font-serif text-2xl font-bold md:text-3xl">Shopping cart</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {hasIssue && <Alert variant="destructive"><AlertDescription>Some items have stock changes. Please update them before checkout.</AlertDescription></Alert>}
          {items.map((it) => (
            <Card key={it.variant_id}>
              <CardContent className="flex gap-4 p-4">
                <Link to={`/product/${it.slug}`} className="size-24 shrink-0 overflow-hidden rounded-md bg-muted sm:size-28">
                  <ProductImage src={it.image} alt={it.name} />
                </Link>
                <div className="flex flex-1 flex-col gap-1">
                  <Link to={`/product/${it.slug}`} className="font-medium hover:underline">{it.name}</Link>
                  <p className="text-sm text-muted-foreground">Size {it.size} · {it.colour}</p>
                  <Price price={it.price} mrp={it.mrp} />
                  {it.stock_issue && <p className="text-sm font-medium text-destructive">{it.stock_issue}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                    {it.max_qty > 0 && (
                      <Select
                        value={String(Math.min(it.qty, Math.max(it.max_qty, 1)))}
                        onValueChange={(v) => (isGuest ? setGuestQty(it.variant_id, Number(v)) : update({ id: it.id, qty: Number(v) }))}
                      >
                        <SelectTrigger className="h-8 w-20" aria-label="Quantity"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: it.max_qty }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>Qty {n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {!isGuest && (
                      <Button variant="ghost" size="sm" onClick={() => toWishlist(it.id)}><Heart /> Move to wishlist</Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => (isGuest ? removeGuest(it.variant_id) : removeItem(it.id))}>
                      <Trash2 /> Remove
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
          <Card>
            <CardHeader><CardTitle className="text-base">Price details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!isGuest && <CouponBox summary={cart.summary} />}
              <PriceSummary summary={cart.summary} count={cart.count} />
              {isGuest ? (
                <Button className="w-full" size="lg" onClick={() => navigate("/login?next=/cart")}>Login to checkout</Button>
              ) : (
                <Button className="w-full" size="lg" disabled={hasIssue} onClick={() => navigate("/checkout")}>Proceed to checkout</Button>
              )}
              {isGuest && <p className="text-center text-xs text-muted-foreground">Apply coupons after you login.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
