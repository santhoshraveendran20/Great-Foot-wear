import { Clock, ExternalLink, MapPin, Navigation, Phone } from "lucide-react"
import { Link } from "react-router-dom"

import { PageLoader, useDocumentTitle } from "@/components/common"
import { useStoreSettings } from "@/components/store/StoreLayout"
import { Button } from "@/components/ui/button"

/** Store finder: the shop's details beside a Google map (location and hours come from Admin → Settings → Store). */
export function StoreFinder() {
  useDocumentTitle("Store finder", "Find the Great Foot Wear store in Manali, Chennai – address, phone numbers and directions.")
  const { data, isLoading } = useStoreSettings()
  if (isLoading) return <PageLoader />
  const store = data?.store ?? {}
  const hasPin = store.map_lat != null && store.map_lng != null && store.map_lat !== "" && store.map_lng !== ""
  // Google's keyless embed: the shop's own listing (name, address, rating card) when its CID is set, else a plain pin
  const embed = store.map_cid
    ? `https://maps.google.com/maps?cid=${store.map_cid}&z=16&output=embed`
    : hasPin ? `https://maps.google.com/maps?q=${store.map_lat},${store.map_lng}&z=15&output=embed` : null
  const directions = store.map_url || (hasPin ? `https://www.google.com/maps/dir/?api=1&destination=${store.map_lat},${store.map_lng}` : null)

  return (
    <div className="grid lg:h-[calc(100vh-7.5rem)] lg:grid-cols-[minmax(0,460px)_1fr]">
      <section className="space-y-6 overflow-y-auto border-r px-4 py-8 sm:px-8">
        <h1 className="text-3xl font-black uppercase tracking-wide md:text-4xl">Store finder</h1>

        <article className="space-y-3 border-b pb-6">
          <h2 className="text-lg font-bold">{store.name || "Great Foot Wear"}</h2>
          {store.address && (
            <p className="flex gap-2 leading-relaxed text-foreground/90">
              <MapPin className="mt-1 size-4 shrink-0 text-muted-foreground" />
              <span>{store.address}{store.pincode && !store.address.includes(store.pincode) ? `, ${store.pincode}` : ""}</span>
            </p>
          )}
          {store.phones?.length > 0 && (
            <div className="flex gap-2">
              <Phone className="mt-1 size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {store.phones.map((ph) => (
                  <a key={ph} href={`tel:+91${ph.replace(/\s/g, "")}`} className="font-medium hover:underline">{ph}</a>
                ))}
              </div>
            </div>
          )}
          {store.opening_hours && (
            <p className="flex gap-2">
              <Clock className="mt-1 size-4 shrink-0 text-muted-foreground" />
              <span className="whitespace-pre-line">{store.opening_hours}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            {directions && (
              <Button asChild>
                <a href={directions} target="_blank" rel="noreferrer"><Navigation /> Get directions</a>
              </Button>
            )}
            <Button variant="outline" asChild><Link to="/contact">Store details</Link></Button>
          </div>
          {data?.shipping?.pickup_enabled && (
            <p className="text-sm text-muted-foreground">Order online and choose <strong>Store pickup</strong> at checkout to collect from this store.</p>
          )}
        </article>
      </section>

      <section className="min-h-[60vh] bg-muted lg:min-h-0" aria-label="Map">
        {embed ? (
          <iframe
            title={`Map showing ${store.name || "Great Foot Wear"}`}
            src={embed}
            className="size-full min-h-[60vh] border-0 lg:min-h-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          <div className="grid size-full min-h-[60vh] place-items-center p-6 text-center text-muted-foreground">
            <div className="space-y-3">
              <p>The map location has not been set yet.</p>
              {directions && <a href={directions} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open in Google Maps <ExternalLink className="size-4" /></a>}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
