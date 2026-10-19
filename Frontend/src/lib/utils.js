import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })

export function formatINR(value) {
  const n = Number(value ?? 0)
  return inr.format(n).replace(/\.00$/, "")
}

export function formatDate(value, withTime = false) {
  if (!value) return "—"
  const d = new Date(String(value).endsWith("Z") || String(value).length <= 10 ? value : `${value}Z`)
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  })
}

export const ORDER_STATUS = {
  pending_payment: { label: "Pending Payment", variant: "warning" },
  confirmed: { label: "Confirmed", variant: "info" },
  packed: { label: "Packed", variant: "info" },
  shipped: { label: "Shipped", variant: "info" },
  out_for_delivery: { label: "Out for Delivery", variant: "info" },
  delivered: { label: "Delivered", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  return_requested: { label: "Return Requested", variant: "warning" },
  returned: { label: "Returned", variant: "secondary" },
  refunded: { label: "Refunded", variant: "secondary" },
}

export const PAYMENT_STATUS = {
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  cod_pending: "COD – to collect",
  cod_collected: "COD – collected",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
}

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
]
