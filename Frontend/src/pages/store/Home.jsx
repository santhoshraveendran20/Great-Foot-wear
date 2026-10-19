import { useEffect, useState } from "react"
import { Store, Truck } from "lucide-react"
import { Link } from "react-router-dom"

import { PageLoader, useDocumentTitle } from "@/components/common"
import { BrandMarquee } from "@/components/store/BrandMarquee"
import { ProductGrid } from "@/components/store/ProductCard"
import { useHome, useStoreSettings } from "@/components/store/StoreLayout"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { cn } from "@/lib/utils"


/**
 * Homepage hero slides (images in public/carousel, made from src/assets_carousel).
 * img1 (a third-party brand campaign with a celebrity) is left out on purpose; add it here only with permission.
 */
const HERO_SLIDES = [
  {
    image: "slide2",
    alt: "School shoes – lightweight, soft insoles, reinforced stitching. Strong steps, small price.",
    links: [["Shop Kids", "/search?q=&gender=kids"]],
  },
  { image: "slide3", alt: "Lightweight running shoes in black, blue and grey", links: [["Shop Men", "/search?q=&gender=men"], ["Shop Women", "/search?q=&gender=women"]] },
  { image: "slide4", alt: "Leather shoes and heeled sandals for an evening out", links: [["Shop Men", "/search?q=&gender=men"], ["Shop Women", "/search?q=&gender=women"]] },
  { image: "slide5", alt: "Suede loafers on grass", links: [["Shop Men", "/search?q=&gender=men"]] },
]
const AUTOPLAY_MS = 7000 // each slide stays 7 seconds

/** Full-width image carousel (Bata-style): arrows, dots, autoplay that pauses on hover. */
function HeroCarousel() {
  const [api, setApi] = useState(null)
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!api) return
    const onSelect = () => setCurrent(api.selectedScrollSnap())
    onSelect()
    api.on("select", onSelect)
    return () => api.off("select", onSelect)
  }, [api])

  useEffect(() => {
    if (!api || paused) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) return
    // one timer per slide, so every slide (also after an arrow / dot click) stays the full 7 seconds
    const t = setTimeout(() => api.scrollNext(), AUTOPLAY_MS)
    return () => clearTimeout(t)
  }, [api, paused, current])

  return (
    <section aria-label="Featured" aria-roledescription="carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <h1 className="sr-only">Great Foot Wear, Manali, Chennai – footwear for the whole family, now online</h1>
      <Carousel setApi={setApi} opts={{ loop: true }} className="relative">
        <CarouselContent className="ml-0">
          {HERO_SLIDES.map((s, i) => (
            <CarouselItem key={s.image} className="pl-0" aria-roledescription="slide" aria-label={`${i + 1} of ${HERO_SLIDES.length}`}>
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted lg:max-h-[calc(100vh-6.5rem)]">
                <img
                  src={`/carousel/${s.image}.webp`}
                  srcSet={`/carousel/${s.image}-sm.webp 960w, /carousel/${s.image}.webp 1920w`}
                  sizes="100vw"
                  alt={s.alt}
                  width={1920}
                  height={1080}
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchpriority={i === 0 ? "high" : undefined}
                  className="size-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 flex justify-center gap-8 bg-gradient-to-t from-black/50 to-transparent px-4 pb-7 pt-10 sm:pb-14 sm:pt-16">
                  {s.links.map(([label, to]) => (
                    <Link key={label} to={to} className="border-b-2 border-white pb-0.5 text-base font-semibold text-white drop-shadow hover:border-transparent sm:text-lg">
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-4 hidden size-11 border-0 bg-white/80 text-zinc-900 hover:bg-white md:flex" />
        <CarouselNext className="right-4 hidden size-11 border-0 bg-white/80 text-zinc-900 hover:bg-white md:flex" />
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2 sm:bottom-5">
          {HERO_SLIDES.map((s, i) => (
            <button
              key={s.image}
              type="button"
              onClick={() => api?.scrollTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === current}
              className={cn("h-1.5 rounded-full bg-white/60 transition-all", i === current ? "w-8 bg-white" : "w-4")}
            />
          ))}
        </div>
      </Carousel>
    </section>
  )
}

/**
 * Two tall promo tiles under the carousel (images in public/carousel, made from src/assets_carousel).
 * The "50% off" tile links to the biggest discounts; keep the wording in line with the real offers.
 */
const PROMO_TILES = [
  { image: "promo-exclusive", alt: "Online exclusive – leather boots and Mary Jane shoes", to: "/search?q=&sort=newest", label: "Shop Now" },
  { image: "promo-sale", alt: "Up to 50% off sports shoes", to: "/search?q=&sort=discount", label: "Shop the Sale" },
]

function PromoTiles() {
  return (
    <section aria-label="Offers" className="mt-1 grid gap-1 sm:grid-cols-2">
      {PROMO_TILES.map((t) => (
        <Link key={t.image} to={t.to} className="group relative block overflow-hidden bg-muted">
          <img
            src={`/carousel/${t.image}.webp`}
            srcSet={`/carousel/${t.image}-sm.webp 640w, /carousel/${t.image}.webp 1200w`}
            sizes="(min-width: 640px) 50vw, 100vw"
            alt={t.alt}
            width={1200}
            height={1423}
            loading="lazy"
            className="aspect-[1200/1423] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
          <span className="absolute inset-x-0 bottom-8 mx-auto w-fit border-b-2 border-white pb-0.5 text-lg font-semibold text-white drop-shadow group-hover:border-transparent">
            {t.label}
          </span>
        </Link>
      ))}
    </section>
  )
}

function BannerCarousel({ banners }) {
  return (
    <section className="container pt-6">
      <Carousel opts={{ loop: true }} className="relative">
        <CarouselContent>
          {banners.map((b) => {
            const inner = (
              <div className="relative aspect-[16/7] overflow-hidden rounded-xl bg-zinc-900 md:aspect-[16/5]">
                {b.image_url && <img src={b.image_url} alt={b.title} className="size-full object-cover" />}
                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/10 to-transparent p-5 text-white md:p-10">
                  <h2 className="font-serif text-2xl font-bold md:text-4xl">{b.title}</h2>
                  {b.subtitle && <p className="mt-1 max-w-xl text-sm text-zinc-200 md:text-base">{b.subtitle}</p>}
                </div>
              </div>
            )
            return (
              <CarouselItem key={b.id}>
                {b.link_url ? <Link to={b.link_url}>{inner}</Link> : inner}
              </CarouselItem>
            )
          })}
        </CarouselContent>
        {banners.length > 1 && (
          <>
            <CarouselPrevious className="left-3 hidden md:flex" />
            <CarouselNext className="right-3 hidden md:flex" />
          </>
        )}
      </Carousel>
    </section>
  )
}

function Section({ title, link, children }) {
  return (
    <section className="container mt-12 space-y-5">
      <div className="flex items-end justify-between">
        <h2 className="font-serif text-2xl font-bold">{title}</h2>
        {link && <Link to={link} className="text-sm font-medium text-primary hover:underline">View all</Link>}
      </div>
      {children}
    </section>
  )
}

export default function Home() {
  useDocumentTitle(null, "Great Foot Wear, Manali, Chennai – shop footwear for men, women and kids online.")
  const { data, isLoading } = useHome()
  const { data: settings } = useStoreSettings()
  if (isLoading) return <PageLoader />
  const banners = data?.banners.filter((b) => b.kind === "banner") ?? []

  return (
    <div>
      {banners.length ? <BannerCarousel banners={banners} /> : <HeroCarousel />}
      <PromoTiles />

      <div className="mt-8">
        <BrandMarquee />
      </div>

      <Section title="Shop by category">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {data?.categories.map((c) => (
            <Link
              key={c.id}
              to={`/category/${c.slug}`}
              className="group flex flex-col overflow-hidden rounded-lg border bg-card text-center transition-shadow hover:shadow-md"
            >
              <div className="aspect-square overflow-hidden bg-muted">
                {c.image_url ? (
                  <img src={c.image_url} alt={c.name} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
                ) : (
                  <div className="grid size-full place-items-center bg-gradient-to-br from-zinc-100 to-zinc-200 font-serif text-3xl font-bold text-zinc-400 dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-500">
                    {c.name[0]}
                  </div>
                )}
              </div>
              <span className="p-2 text-sm font-medium">{c.name}</span>
            </Link>
          ))}
        </div>
      </Section>

      {data?.new_arrivals.length > 0 && (
        <Section title="New arrivals" link="/search?q=&sort=newest">
          <ProductGrid products={data.new_arrivals} />
        </Section>
      )}

      {data?.best_sellers.length > 0 && (
        <Section title="Best sellers" link="/search?q=&sort=popularity">
          <ProductGrid products={data.best_sellers} />
        </Section>
      )}

      <section className="container mt-12 grid gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-4 rounded-lg border p-5">
          <Truck className="mt-0.5 size-6 text-primary" />
          <div>
            <h3 className="font-semibold">Home delivery</h3>
            <p className="text-sm text-muted-foreground">
              Check delivery date and Cash on Delivery for your PIN code on any product page.
              {settings?.shipping?.free_shipping_threshold ? ` Free shipping above ₹${settings.shipping.free_shipping_threshold}.` : ""}
            </p>
          </div>
        </div>
        {settings?.shipping?.pickup_enabled && (
          <div className="flex items-start gap-4 rounded-lg border p-5">
            <Store className="mt-0.5 size-6 text-primary" />
            <div>
              <h3 className="font-semibold">Store pickup</h3>
              <p className="text-sm text-muted-foreground">Order online and collect from our store: {settings.store.address}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
