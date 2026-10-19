import { useState } from "react"
import { Heart, ShoppingBag, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { EmptyState, PageLoader, Price, ProductImage, useDocumentTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCart } from "@/store/cart"
import { errorMessage } from "@/lib/api"
import { useGetWishlistQuery, useMoveWishlistItemToCartMutation } from "@/store/api/catalogApi"
import { useRemoveFromWishlistMutation } from "@/store/api/commonApi"

function WishItem({ p }) {
  const { setServerCart } = useCart()
  const [variantId, setVariantId] = useState("")
  // both mutations refresh the wishlist and the wishlist ids (invalidatesTags)
  const [remove] = useRemoveFromWishlistMutation()
  const [move, { isLoading: moving }] = useMoveWishlistItemToCartMutation()
  const moveToCart = () =>
    move({ productId: p.id, variantId: Number(variantId), qty: 1 })
      .unwrap()
      .then((cart) => {
        setServerCart(cart)
        toast.success("Moved to cart")
      })
      .catch((e) => toast.error(errorMessage(e)))
  const available = p.variants.filter((v) => v.in_stock)
  return (
    <Card className="overflow-hidden">
      <Link to={`/product/${p.slug}`} className="block aspect-square bg-muted"><ProductImage src={p.image} alt={p.name} /></Link>
      <CardContent className="space-y-2 p-3">
        <Link to={`/product/${p.slug}`} className="line-clamp-2 text-sm font-medium hover:underline">{p.name}</Link>
        <Price price={p.price} mrp={p.mrp} discount={p.discount_pct} />
        {available.length && p.is_active ? (
          <Select value={variantId} onValueChange={setVariantId}>
            <SelectTrigger className="h-9" aria-label="Choose size"><SelectValue placeholder="Select size / colour" /></SelectTrigger>
            <SelectContent>
              {available.map((v) => <SelectItem key={v.id} value={String(v.id)}>Size {v.size} · {v.colour}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">Out of stock</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" disabled={!variantId || moving} onClick={moveToCart}><ShoppingBag /> Move to cart</Button>
          <Button size="icon" variant="outline" className="size-8" onClick={() => remove(p.id)} aria-label="Remove from wishlist"><Trash2 /></Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Wishlist() {
  useDocumentTitle("Wishlist")
  const { data, isLoading } = useGetWishlistQuery()
  if (isLoading) return <PageLoader />
  return (
    <div className="container py-6">
      <h1 className="mb-6 font-serif text-2xl font-bold md:text-3xl">My wishlist</h1>
      {!data?.length ? (
        <EmptyState icon={Heart} title="Your wishlist is empty" description="Tap the heart on any product to save it here." action={<Button asChild><Link to="/">Explore products</Link></Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {data.map((p) => <WishItem key={p.id} p={p} />)}
        </div>
      )}
    </div>
  )
}
