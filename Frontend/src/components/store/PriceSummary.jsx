import { Separator } from "@/components/ui/separator"
import { formatINR } from "@/lib/utils"

/** CW-03: item total, discount, coupon, shipping, GST included, grand total. */
export function PriceSummary({ summary, count }) {
  if (!summary) return null
  const Row = ({ label, value, className }) => (
    <div className={`flex justify-between text-sm ${className || ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
  return (
    <div className="space-y-2">
      <Row label={`Total MRP${count ? ` (${count} ${count === 1 ? "item" : "items"})` : ""}`} value={formatINR(summary.mrp_total)} />
      {Number(summary.product_discount) > 0 && <Row label="Discount on MRP" value={`– ${formatINR(summary.product_discount)}`} className="[&>span:last-child]:text-emerald-700 dark:[&>span:last-child]:text-emerald-400" />}
      {Number(summary.coupon_discount) > 0 && (
        <Row label={`Coupon (${summary.coupon_code})`} value={`– ${formatINR(summary.coupon_discount)}`} className="[&>span:last-child]:text-emerald-700 dark:[&>span:last-child]:text-emerald-400" />
      )}
      <Row label="Shipping" value={Number(summary.shipping) === 0 ? "Free" : formatINR(summary.shipping)} />
      {Number(summary.cod_fee) > 0 && <Row label="COD fee" value={formatINR(summary.cod_fee)} />}
      <Separator />
      <div className="flex justify-between font-semibold">
        <span>Total</span>
        <span>{formatINR(summary.total)}</span>
      </div>
      <p className="text-xs text-muted-foreground">Inclusive of GST {formatINR(summary.tax)}</p>
      {summary.free_shipping_threshold && Number(summary.shipping) > 0 && (
        <p className="text-xs text-primary">Add items worth {formatINR(Number(summary.free_shipping_threshold) - (Number(summary.subtotal) - Number(summary.coupon_discount)))} more for free shipping.</p>
      )}
    </div>
  )
}
