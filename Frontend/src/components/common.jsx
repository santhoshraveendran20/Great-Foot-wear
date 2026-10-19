import { useEffect } from "react"
import { Link } from "react-router-dom"
import { Loader2, Star } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn, formatINR, ORDER_STATUS, PAYMENT_STATUS } from "@/lib/utils"

const BRAND_FILES = { wide: "gfw-logo-wide", stacked: "gfw-logo", mark: "gfw-mark" }

/**
 * The Great Foot Wear logo, cut from the owner's artwork (public/brand).
 * variant: "wide" (GFW + name + tagline in one row) | "stacked" (as in the artwork) | "mark" (GFW only).
 * tone: "auto" follows the light/dark theme; "light-ink" always uses the version for dark surfaces.
 */
export function BrandLogo({ variant = "wide", tone = "auto", className }) {
  const file = BRAND_FILES[variant]
  if (tone === "light-ink") return <img src={`/brand/${file}-dark.png`} alt="Great Foot Wear" className={cn("w-auto", className)} />
  return (
    <>
      <img src={`/brand/${file}.png`} alt="Great Foot Wear" className={cn("w-auto dark:hidden", className)} />
      <img src={`/brand/${file}-dark.png`} alt="Great Foot Wear" className={cn("hidden w-auto dark:block", className)} />
    </>
  )
}

/** Header logo link: GFW mark on phones, full lock-up from the sm breakpoint; compact = stacked logo (login pages). */
export function Logo({ className, compact = false, large = false }) {
  return (
    <Link to="/" className={cn("flex items-center", className)} aria-label="Great Foot Wear home">
      {compact ? (
        <BrandLogo variant="stacked" className="h-24" />
      ) : (
        <>
          <span className="sm:hidden"><BrandLogo variant="mark" className="h-7" /></span>
          <span className="hidden sm:block"><BrandLogo variant="wide" className={large ? "h-12" : "h-9"} /></span>
        </>
      )}
    </Link>
  )
}

/** NF-09 meta tags: title + description per page. */
export function useDocumentTitle(title, description) {
  useEffect(() => {
    document.title = title ? `${title} | Great Foot Wear` : "Great Foot Wear"
    if (description) {
      document.querySelector('meta[name="description"]')?.setAttribute("content", description)
      document.querySelector('meta[property="og:description"]')?.setAttribute("content", description)
    }
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title)
  }, [title, description])
}

export function OrderStatusBadge({ status }) {
  const s = ORDER_STATUS[status] || { label: status, variant: "secondary" }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function PaymentStatusBadge({ status }) {
  const variant = { paid: "success", cod_collected: "success", failed: "destructive", refunded: "secondary", partially_refunded: "secondary" }[status] || "outline"
  return <Badge variant={variant}>{PAYMENT_STATUS[status] || status}</Badge>
}

export function Price({ price, mrp, discount, className, size = "base" }) {
  const big = size === "lg"
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={cn("font-semibold", big ? "text-2xl" : "text-base")}>{formatINR(price)}</span>
      {mrp && Number(mrp) > Number(price) && (
        <>
          <span className={cn("text-muted-foreground line-through", big ? "text-base" : "text-sm")}>{formatINR(mrp)}</span>
          {discount > 0 && <span className={cn("font-medium text-emerald-700 dark:text-emerald-400", big ? "text-base" : "text-sm")}>{discount}% off</span>}
        </>
      )}
    </div>
  )
}

/**
 * Large deal price used on product cards and the product page:
 * card  -> ₹899  M.R.P: ₹1,899 (53% off)
 * page  -> -53% ₹899, then "M.R.P.: ₹1,899" on the next line
 */
export function DealPrice({ price, mrp, discount, size = "md", className }) {
  const page = size === "lg"
  const hasMrp = mrp && Number(mrp) > Number(price)
  const amount = formatINR(price).replace("₹", "")
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {page && hasMrp && discount > 0 && <span className="text-2xl font-light text-destructive md:text-3xl">-{discount}%</span>}
        <span className="flex items-start font-medium leading-none" aria-label={formatINR(price)}>
          <span className={page ? "mt-1 text-sm" : "mt-0.5 text-xs"} aria-hidden="true">₹</span>
          <span className={page ? "text-3xl" : "text-2xl"} aria-hidden="true">{amount}</span>
        </span>
        {!page && hasMrp && (
          <span className="text-xs text-muted-foreground">
            M.R.P: <span className="line-through">{formatINR(mrp)}</span>
            {discount > 0 && <span className="ml-1 text-foreground">({discount}% off)</span>}
          </span>
        )}
      </div>
      {page && hasMrp && <p className="text-sm text-muted-foreground">M.R.P.: <span className="line-through">{formatINR(mrp)}</span></p>}
    </div>
  )
}

export function RatingStars({ value = 0, count, className }) {
  const v = Number(value)
  return (
    <div className={cn("flex items-center gap-1 text-sm", className)} aria-label={`Rated ${v.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("size-4", i <= Math.round(v) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
      ))}
      {count !== undefined && <span className="text-muted-foreground">({count})</span>}
    </div>
  )
}

export function PageLoader({ className }) {
  return (
    <div className={cn("flex min-h-[40vh] items-center justify-center", className)}>
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center", className)}>
      {Icon && <Icon className="size-10 text-muted-foreground" />}
      <div className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function ProductImage({ src, alt, className }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" className={cn("size-full object-cover", className)} />
  ) : (
    <div className={cn("grid size-full place-items-center bg-muted text-xs text-muted-foreground", className)}>No image</div>
  )
}
