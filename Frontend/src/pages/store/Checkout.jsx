import { useEffect, useState } from "react"
import { Banknote, CreditCard, Loader2, MapPin, Plus, Store, Truck } from "lucide-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { PageLoader, ProductImage, useDocumentTitle } from "@/components/common"
import { AddressDialog } from "@/components/store/AddressForm"
import { PriceSummary } from "@/components/store/PriceSummary"
import { useStoreSettings } from "@/components/store/StoreLayout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import { errorMessage } from "@/lib/api"
import { useCheckPincodeQuery, useGetAddressesQuery } from "@/store/api/commonApi"
import { useGetCheckoutQuoteQuery, usePlaceCheckoutOrderMutation } from "@/store/api/checkoutApi"
import { useResendEmailVerificationMutation } from "@/store/api/accountApi"
import { payWithRazorpay } from "@/lib/razorpay"
import { cn } from "@/lib/utils"

function Option({ value, current, icon: Icon, title, description, disabled }) {
  return (
    <Label
      htmlFor={`opt-${value}`}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal transition-colors",
        current === value && "border-primary bg-primary/5",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <RadioGroupItem value={value} id={`opt-${value}`} disabled={disabled} className="mt-0.5" />
      <Icon className="mt-0.5 size-5 text-muted-foreground" />
      <span className="space-y-0.5">
        <span className="block font-medium">{title}</span>
        {description && <span className="block text-sm text-muted-foreground">{description}</span>}
      </span>
    </Label>
  )
}

export default function Checkout() {
  useDocumentTitle("Checkout")
  const { user } = useAuth()
  const { cart, loading } = useCart()
  const navigate = useNavigate()
  const { data: settings } = useStoreSettings()
  const [fulfilment, setFulfilment] = useState("delivery")
  const [addressId, setAddressId] = useState(null)
  const [payment, setPayment] = useState(null)
  const [dialog, setDialog] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [resendEmail, { isLoading: resending }] = useResendEmailVerificationMutation()
  const [emailSent, setEmailSent] = useState(false)

  const { data: addresses = [], isLoading: addrLoading } = useGetAddressesQuery()
  useEffect(() => {
    if (!addressId && addresses.length) setAddressId((addresses.find((a) => a.is_default) || addresses[0]).id)
  }, [addresses, addressId])

  const selected = addresses.find((a) => a.id === addressId)
  const { data: quote } = useGetCheckoutQuoteQuery(
    { fulfilment, addressId, payment, count: cart?.count, couponCode: cart?.summary?.coupon_code },
    { skip: !cart?.items?.length }
  )
  const { data: pin } = useCheckPincodeQuery(
    { pincode: selected?.pincode, orderValue: quote?.summary?.total },
    { skip: !(fulfilment === "delivery" && !!selected) }
  )

  const onlineEnabled = settings?.online_payment_enabled
  const codAllowed =
    settings?.cod?.enabled &&
    (fulfilment === "pickup" || pin?.cod_available) &&
    (!settings?.cod?.max_order_value || Number(quote?.summary?.total ?? 0) <= Number(settings.cod.max_order_value))

  useEffect(() => {
    if (payment === "cod" && codAllowed === false) setPayment(null)
  }, [codAllowed, payment])

  // invalidates the cart and the order list
  const [placeOrder] = usePlaceCheckoutOrderMutation()

  if (loading || addrLoading) return <PageLoader />
  if (!cart?.items?.length && !placing) return <Navigate to="/cart" replace />

  const notDeliverable = fulfilment === "delivery" && pin && !pin.serviceable
  const canPlace = payment && (fulfilment === "pickup" || (selected && !notDeliverable)) && user.is_verified

  const submit = async () => {
    setPlacing(true)
    try {
      const res = await placeOrder({ fulfilment, addressId, payment }).unwrap()
      if (payment === "cod") {
        navigate(`/order/${res.order.id}/success`, { replace: true })
        return
      }
      const result = await payWithRazorpay(res.order.id, res.razorpay)
      navigate(`/order/${res.order.id}/${result === "paid" ? "success" : "failed"}`, { replace: true })
    } catch (e) {
      toast.error(errorMessage(e))
      setPlacing(false)
    }
  }

  return (
    <div className="container py-6">
      <h1 className="mb-6 font-serif text-2xl font-bold md:text-3xl">Checkout</h1>
      {!user.is_verified && (
        <Alert className="mb-6" variant="destructive">
          <AlertTitle>Verify your account to place an order</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {!user.mobile_verified && "Your mobile number is not verified. "}
              {!user.email_verified && "Your email is not verified — open the link we emailed you. "}
            </p>
            <div className="flex flex-wrap gap-2">
              {!user.mobile_verified && <Button size="sm" variant="outline" asChild><Link to="/verify-otp?next=/checkout">Verify mobile</Link></Button>}
              {!user.email_verified && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resending || emailSent}
                  onClick={() =>
                    resendEmail()
                      .unwrap()
                      .then(() => { setEmailSent(true); toast.success(`Verification link sent to ${user.email}`) })
                      .catch((e) => toast.error(errorMessage(e)))
                  }
                >
                  {emailSent ? "Email sent" : "Resend verification email"}
                </Button>
              )}
              <Button size="sm" variant="outline" asChild><Link to="/account">Account settings</Link></Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">1. Delivery</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={fulfilment} onValueChange={setFulfilment} className="grid gap-3 sm:grid-cols-2">
                <Option value="delivery" current={fulfilment} icon={Truck} title="Home delivery" description="Delivered to your address" />
                {settings?.shipping?.pickup_enabled && (
                  <Option value="pickup" current={fulfilment} icon={Store} title="Store pickup" description="Collect from our Manali store – no shipping charge" />
                )}
              </RadioGroup>

              {fulfilment === "delivery" ? (
                <div className="space-y-3">
                  {addresses.length > 0 && (
                    <RadioGroup value={addressId ? String(addressId) : ""} onValueChange={(v) => setAddressId(Number(v))} className="space-y-2">
                      {addresses.map((a) => (
                        <Label key={a.id} htmlFor={`addr-${a.id}`} className={cn("flex cursor-pointer gap-3 rounded-lg border p-4 font-normal", addressId === a.id && "border-primary bg-primary/5")}>
                          <RadioGroupItem value={String(a.id)} id={`addr-${a.id}`} className="mt-0.5" />
                          <span className="space-y-0.5 text-sm">
                            <span className="block font-medium">{a.name} · {a.mobile}</span>
                            <span className="block text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} – {a.pincode}</span>
                          </span>
                        </Label>
                      ))}
                    </RadioGroup>
                  )}
                  <Button variant="outline" onClick={() => setDialog(true)}><Plus /> Add new address</Button>
                  {pin && selected && (
                    <p className={cn("flex items-center gap-2 text-sm", pin.serviceable ? "text-muted-foreground" : "text-destructive")}>
                      <MapPin className="size-4" />
                      {pin.serviceable ? `Estimated delivery ${new Date(pin.estimated_delivery_from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(pin.estimated_delivery_to).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : `We do not deliver to ${selected.pincode} yet.`}
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-md bg-muted p-3 text-sm">Pickup from: {settings?.store?.address}. We will notify you when your order is ready.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">2. Payment</CardTitle></CardHeader>
            <CardContent>
              <RadioGroup value={payment ?? ""} onValueChange={setPayment} className="space-y-3">
                <Option
                  value="online" current={payment} icon={CreditCard} disabled={!onlineEnabled}
                  title="Pay online"
                  description={onlineEnabled ? "UPI (GPay, PhonePe, Paytm), debit / credit cards, net banking, wallets" : "Currently unavailable"}
                />
                <Option
                  value="cod" current={payment} icon={Banknote} disabled={!codAllowed}
                  title="Cash on Delivery"
                  description={codAllowed
                    ? `Pay when you receive the order${Number(settings?.cod?.fee) > 0 ? ` (COD fee ₹${settings.cod.fee})` : ""}`
                    : "Not available for this PIN code / order value"}
                />
              </RadioGroup>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
          <Card>
            <CardHeader><CardTitle className="text-base">Order summary</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                {cart?.items?.map((it) => (
                  <li key={it.variant_id} className="flex gap-3 text-sm">
                    <span className="size-14 shrink-0 overflow-hidden rounded bg-muted"><ProductImage src={it.image} alt="" /></span>
                    <span className="flex-1">
                      <span className="line-clamp-1 font-medium">{it.name}</span>
                      <span className="text-muted-foreground">Size {it.size} · {it.colour} · Qty {it.qty}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <PriceSummary summary={quote?.summary ?? cart?.summary} count={cart?.count} />
              {quote?.summary?.coupon_error && <p className="text-sm text-destructive">Coupon: {quote.summary.coupon_error}</p>}
              <Button size="lg" className="w-full" disabled={!canPlace || placing} onClick={submit}>
                {placing && <Loader2 className="animate-spin" />}
                {payment === "online" ? "Pay & place order" : "Place order"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                By placing this order you agree to our <Link to="/terms" className="underline">Terms</Link> and <Link to="/returns" className="underline">Return policy</Link>.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
      <AddressDialog
        open={dialog}
        onOpenChange={setDialog}
        onSaved={(a) => setAddressId(a.id)}
      />
    </div>
  )
}
