import { useState } from "react"
import { useDispatch } from "react-redux"
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { PageLoader, useDocumentTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { errorMessage } from "@/lib/api"
import { payWithRazorpay } from "@/lib/razorpay"
import { formatINR } from "@/lib/utils"
import { useCreateOrderPaymentMutation } from "@/store/api/checkoutApi"
import { useGetOrderQuery } from "@/store/api/commonApi"
import { baseApi } from "@/store/baseApi"

export function useRetryPayment(orderId) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [createPayment] = useCreateOrderPaymentMutation()
  const [busy, setBusy] = useState(false)
  const retry = async () => {
    setBusy(true)
    try {
      const data = await createPayment(orderId).unwrap()
      const result = await payWithRazorpay(Number(orderId), data.razorpay)
      dispatch(baseApi.util.invalidateTags([{ type: "Order", id: String(orderId) }]))
      navigate(`/order/${orderId}/${result === "paid" ? "success" : "failed"}`, { replace: true })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return { retry, busy }
}

/** CO-05 confirmation page and PY-06 failure / retry page. */
export function OrderResult({ outcome }) {
  const { id } = useParams()
  const { data: o, isLoading } = useGetOrderQuery(id)
  const { retry, busy } = useRetryPayment(id)
  useDocumentTitle(outcome === "success" ? "Order placed" : "Payment not completed")
  if (isLoading) return <PageLoader />
  if (!o) return null

  const confirmed = o.order_status !== "pending_payment" && o.order_status !== "cancelled"
  return (
    <div className="container flex min-h-[60vh] items-center justify-center py-10">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-5 p-8 text-center">
          {confirmed ? (
            <>
              <CheckCircle2 className="mx-auto size-14 text-emerald-600 dark:text-emerald-400" />
              <h1 className="font-serif text-2xl font-bold">Thank you! Your order is confirmed.</h1>
              <p className="text-muted-foreground">
                Order <strong className="text-foreground">{o.order_no}</strong> · {formatINR(o.total)}
                {o.payment_method === "cod" ? " · Cash on Delivery" : " · Paid online"}
              </p>
              <p className="text-sm text-muted-foreground">We've sent the details by email and SMS.</p>
            </>
          ) : o.order_status === "pending_payment" ? (
            <>
              {outcome === "success" ? <Clock className="mx-auto size-14 text-amber-500" /> : <XCircle className="mx-auto size-14 text-destructive" />}
              <h1 className="font-serif text-2xl font-bold">{outcome === "success" ? "Confirming your payment…" : "Payment not completed"}</h1>
              <p className="text-muted-foreground">
                Order <strong className="text-foreground">{o.order_no}</strong> is awaiting payment. Items are held for 15 minutes; after that they are released, but you can still retry.
              </p>
              <Button size="lg" onClick={retry} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Retry payment</Button>
            </>
          ) : (
            <>
              <XCircle className="mx-auto size-14 text-destructive" />
              <h1 className="font-serif text-2xl font-bold">Order {o.order_no} was cancelled</h1>
              {o.cancel_reason && <p className="text-muted-foreground">{o.cancel_reason}</p>}
            </>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" asChild><Link to={`/account/orders/${o.id}`}>View order</Link></Button>
            <Button variant="ghost" asChild><Link to="/">Continue shopping</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
