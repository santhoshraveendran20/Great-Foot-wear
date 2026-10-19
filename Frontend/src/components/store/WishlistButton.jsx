import { Heart } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAddToWishlistMutation, useGetWishlistIdsQuery, useRemoveFromWishlistMutation } from "@/store/api/commonApi"
import { useAuth } from "@/store/auth"

export function useWishlistIds() {
  const { user } = useAuth()
  return useGetWishlistIdsQuery(undefined, { skip: user?.role !== "customer" })
}

export function WishlistButton({ productId, className, withLabel = false }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: ids = [] } = useWishlistIds()
  const active = ids.includes(productId)
  const [add, addState] = useAddToWishlistMutation()
  const [remove, removeState] = useRemoveFromWishlistMutation()
  const busy = addState.isLoading || removeState.isLoading

  const onClick = (e) => {
    e.preventDefault()
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
      return
    }
    if (user.role !== "customer") return
    ;(active ? remove : add)(productId)
      .unwrap()
      .then(() => toast.success(active ? "Removed from wishlist" : "Added to wishlist"))
      .catch((err) => toast.error(errorMessage(err)))
  }

  if (withLabel) {
    return (
      <Button variant="outline" size="lg" onClick={onClick} disabled={busy} className={className}>
        <Heart className={cn(active && "fill-red-500 text-red-500")} />
        {active ? "Wishlisted" : "Wishlist"}
      </Button>
    )
  }
  return (
    <Button
      variant="secondary"
      size="icon"
      onClick={onClick}
      disabled={busy}
      aria-label={active ? "Remove from wishlist" : "Add to wishlist"}
      className={cn("size-8 rounded-full bg-white/90 text-zinc-900 shadow-sm hover:bg-white", className)}
    >
      <Heart className={cn("size-4", active && "fill-red-500 text-red-500")} />
    </Button>
  )
}
