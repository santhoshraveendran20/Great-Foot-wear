import { api } from "@/lib/api"

const SRC = "https://checkout.razorpay.com/v1/checkout.js"
let loading = null

function loadScript() {
  if (window.Razorpay) return Promise.resolve()
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script")
      s.src = SRC
      s.onload = resolve
      s.onerror = () => {
        loading = null
        reject(new Error("Could not load the payment window. Check your connection."))
      }
      document.body.appendChild(s)
    })
  }
  return loading
}

/**
 * Opens Razorpay Checkout (UPI, cards, net banking, wallets — PY-01).
 * Success is confirmed only after the backend verifies the signature (PY-04).
 * Resolves to "paid" | "failed" | "dismissed".
 */
export async function payWithRazorpay(orderId, rz) {
  await loadScript()
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    const checkout = new window.Razorpay({
      key: rz.key_id,
      order_id: rz.gateway_order_id,
      amount: rz.amount,
      currency: rz.currency,
      name: rz.name,
      description: rz.description,
      prefill: rz.prefill,
      theme: { color: "#1d4ed8" },
      handler: async (resp) => {
        try {
          await api.post("/payments/verify", { order_id: orderId, ...resp })
          done("paid")
        } catch {
          done("failed")
        }
      },
      modal: { ondismiss: () => done("dismissed") },
    })
    checkout.on("payment.failed", (resp) => {
      api
        .post("/payments/failed", { order_id: orderId, razorpay_order_id: rz.gateway_order_id, reason: resp?.error?.description?.slice(0, 250) })
        .catch(() => {})
    })
    checkout.open()
  })
}
