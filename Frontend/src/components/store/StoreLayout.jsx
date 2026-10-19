import { Fragment, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Heart, LayoutDashboard, LogOut, MapPin, Menu, Package, Phone, ShieldCheck, ShoppingBag, User } from "lucide-react"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"

import { BrandLogo, Logo, PageLoader } from "@/components/common"
import { SearchBox } from "@/components/store/SearchBox"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useGetCategoriesQuery, useGetHomeQuery, useGetStoreSettingsQuery } from "@/store/api/commonApi"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"

export const useStoreSettings = () => useGetStoreSettingsQuery()

export const useHome = () => useGetHomeQuery()

function OfferStrip() {
  const { data } = useHome()
  const strips = data?.banners.filter((b) => b.kind === "offer_strip") ?? []
  if (!strips.length) return null
  const s = strips[0]
  const content = (
    <span>
      <strong>{s.title}</strong>
      {s.subtitle && <span className="opacity-90"> — {s.subtitle}</span>}
    </span>
  )
  return (
    <div className="bg-primary px-4 py-2 text-center text-xs text-primary-foreground sm:text-sm">
      {s.link_url ? <Link to={s.link_url} className="hover:underline">{content}</Link> : content}
    </div>
  )
}

const NAV_GAP = 32 // px, matches gap-8
const navItemClass = "flex h-full items-center whitespace-nowrap border-b-2 border-transparent text-[15px] uppercase tracking-wide text-foreground/90 transition-colors hover:border-foreground hover:text-foreground"

/** Top-level categories (a category whose parent is not in the list counts as top level). */
function useCategoryTree() {
  const { data } = useGetCategoriesQuery()
  const all = useMemo(() => data ?? [], [data])
  const top = useMemo(() => all.filter((c) => !c.parent_id || !all.some((p) => p.id === c.parent_id)), [all])
  const childrenOf = (id) => all.filter((c) => c.parent_id === id)
  return { all, top, childrenOf }
}

/**
 * Desktop menu, centred: as many top-level categories as fit (re-measured on resize), the rest under "More".
 * Hovering or focusing a category opens its mega menu (MegaMenu, rendered by Header).
 */
function MainNav({ openId, onOpen }) {
  const { top, childrenOf } = useCategoryTree()
  const navigate = useNavigate()
  const boxRef = useRef(null)
  const measureRef = useRef(null)
  const [fit, setFit] = useState(top.length)
  useLayoutEffect(() => {
    const box = boxRef.current
    const measure = measureRef.current
    if (!box || !measure) return
    const calc = () => {
      const widths = [...measure.children].map((el) => el.getBoundingClientRect().width)
      const moreWidth = widths.pop()
      const avail = box.clientWidth
      const total = widths.reduce((s, w, i) => s + w + (i ? NAV_GAP : 0), 0)
      if (total <= avail) return setFit(widths.length)
      let used = moreWidth
      let n = 0
      for (const w of widths) {
        if (used + NAV_GAP + w > avail) break
        used += NAV_GAP + w
        n += 1
      }
      setFit(n)
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(box)
    return () => ro.disconnect()
  }, [top])

  const shown = top.slice(0, fit)
  const rest = top.slice(fit)
  return (
    <div ref={boxRef} className="relative h-full min-w-0 flex-1">
      {/* invisible copy used only to measure each item's width */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute flex h-full">
        {top.map((c) => <span key={c.id} className={navItemClass}>{c.name}</span>)}
        <span className={cn(navItemClass, "gap-1")}>More<ChevronDown className="size-4" /></span>
      </div>
      <nav aria-label="Categories" className="flex h-full items-stretch justify-center gap-8">
        {shown.map((c) => (
          <NavLink
            key={c.id}
            to={`/category/${c.slug}`}
            onMouseEnter={() => onOpen(c.id)}
            onFocus={() => onOpen(c.id)}
            aria-expanded={openId === c.id}
            className={({ isActive }) => cn(navItemClass, (isActive || openId === c.id) && "border-foreground font-semibold text-foreground")}
          >
            {c.name}
          </NavLink>
        ))}
        {rest.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger onMouseEnter={() => onOpen(null)} className={cn(navItemClass, "gap-1 outline-none")}>
              More<ChevronDown className="size-4 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {rest.map((c) => (
                <Fragment key={c.id}>
                  <DropdownMenuItem onClick={() => navigate(`/category/${c.slug}`)}>{c.name}</DropdownMenuItem>
                  {childrenOf(c.id).map((k) => (
                    <DropdownMenuItem key={k.id} className="pl-6 text-muted-foreground" onClick={() => navigate(`/category/${k.slug}`)}>{k.name}</DropdownMenuItem>
                  ))}
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </div>
  )
}

/** Full-width panel under the header for one category: featured filters, sub-categories, category picture, "All …" bar. */
function MegaMenu({ categoryId, onClose, onKeep }) {
  const { all, childrenOf } = useCategoryTree()
  const c = all.find((x) => x.id === categoryId)
  if (!c) return null
  const base = `/category/${c.slug}`
  const kids = childrenOf(c.id)
  // only filters the listing page really supports (sort, discount_min, price_max)
  const featured = [
    ["New Arrivals", `${base}?sort=newest`],
    ["Best Sellers", `${base}?sort=popularity`],
    ["Offers – 20% off or more", `${base}?discount_min=20`],
    ["Under ₹999", `${base}?price_max=999`],
  ]
  const linkClass = "block py-1 text-sm text-foreground/80 hover:text-foreground hover:underline"
  return (
    <div
      className="absolute inset-x-0 top-full z-50 border-b bg-background shadow-xl"
      onMouseEnter={onKeep}
      onMouseLeave={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="container grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)] gap-10 py-8">
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide">Featured</h3>
          {featured.map(([label, to]) => <Link key={to} to={to} onClick={onClose} className={linkClass}>{label}</Link>)}
        </div>
        <div className="col-span-2">
          {kids.length > 0 ? (
            <>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide">{c.name}</h3>
              <div className="columns-2 gap-10">
                {kids.map((k) => <Link key={k.id} to={`/category/${k.slug}`} onClick={onClose} className={linkClass}>{k.name}</Link>)}
              </div>
            </>
          ) : (
            <>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide">Shop {c.name}</h3>
              <Link to={base} onClick={onClose} className={linkClass}>All products</Link>
              <Link to={`${base}?sort=price_asc`} onClick={onClose} className={linkClass}>Price: low to high</Link>
              <Link to={`${base}?sort=discount`} onClick={onClose} className={linkClass}>Biggest discounts</Link>
            </>
          )}
        </div>
        <Link to={base} onClick={onClose} className="group block overflow-hidden border bg-muted">
          {c.image_url ? (
            <img src={c.image_url} alt="" className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="grid aspect-[4/3] place-items-center bg-gradient-to-br from-zinc-100 to-zinc-200 font-serif text-5xl font-bold text-zinc-400 dark:from-zinc-800 dark:to-zinc-900">{c.name[0]}</div>
          )}
          <p className="p-4 text-sm font-bold uppercase tracking-wide">Shop {c.name}</p>
        </Link>
      </div>
      <div className="border-t">
        <div className="container py-3">
          <Link to={base} onClick={onClose} className="text-sm font-bold hover:underline">All {c.name}</Link>
        </div>
      </div>
    </div>
  )
}

function CategoryNav({ className, onNavigate }) {
  const { data } = useHome()
  return (
    <nav className={className} aria-label="Categories">
      {data?.categories.map((c) => (
        <NavLink
          key={c.id}
          to={`/category/${c.slug}`}
          onClick={onNavigate}
          className={({ isActive }) => cn("whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-foreground", isActive && "text-primary")}
        >
          {c.name}
        </NavLink>
      ))}
    </nav>
  )
}

/** Signed-in menu (My account, orders, wishlist, addresses, logout). Signed out: a plain link to the customer login. */
function AccountMenu({ iconOnly = false }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  if (!user) {
    return iconOnly ? (
      <Button variant="ghost" size="icon" asChild><Link to="/login" aria-label="Log in"><User className="size-5" /></Link></Button>
    ) : (
      <Button variant="ghost" size="sm" asChild><Link to="/login"><User /> <span className="hidden sm:inline">Login</span></Link></Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {iconOnly ? (
          <Button variant="ghost" size="icon" className="relative" aria-label="Account menu">
            <User className="size-5" />
            <span className="absolute right-1 top-1 size-2 rounded-full bg-emerald-500 ring-2 ring-background" aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" aria-label="Account menu">
            <User /> <span className="hidden max-w-24 truncate sm:inline">{user.name.split(" ")[0]}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role !== "customer" ? (
          <DropdownMenuItem onClick={() => navigate("/admin")}><LayoutDashboard /> Admin panel</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => navigate("/account")}><User /> My account</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/account/orders")}><Package /> My orders</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/wishlist")}><Heart /> Wishlist</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/account/addresses")}><MapPin /> Addresses</DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={async () => { await logout(); navigate("/") }}><LogOut /> Logout</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CartLink({ count }) {
  return (
    <Button variant="ghost" size="icon" asChild className="relative">
      <Link to="/cart" aria-label={`Cart, ${count} items`}>
        <ShoppingBag className="size-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background">
            {count}
          </span>
        )}
      </Link>
    </Button>
  )
}

/** Desktop (lg+) header: small utility links on top; logo, centred categories, search box and icons below. */
function DesktopHeader({ count, showShopIcons, megaId, onOpenMega }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const util = "hover:underline"
  return (
    <div className="container hidden lg:block">
      <div className="flex items-center justify-end gap-5 pt-2 text-xs lowercase text-foreground/80">
        <Link to="/store-finder" className={util}>store finder</Link>
        <Link to="/shipping" className={util}>help</Link>
        <Link to="/account/orders" className={util}>orders and returns</Link>
        {user ? (
          <>
            <span>hi, {user.name.split(" ")[0]}</span>
            <button type="button" className={util} onClick={async () => { await logout(); navigate("/") }}>log out</button>
          </>
        ) : (
          <>
            <Link to="/register" className={util}>sign up</Link>
            {/* customers and shop staff sign in on different pages */}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(util, "inline-flex items-center gap-0.5 outline-none")} aria-label="Log in options">
                log in <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 normal-case">
                <DropdownMenuItem onClick={() => navigate("/login")}><User /> Customer login</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/admin/login")}><ShieldCheck /> Admin / staff login</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      <div className="flex h-14 items-stretch gap-8">
        <Logo className="shrink-0" />
        <MainNav openId={megaId} onOpen={onOpenMega} />
        <div className="flex shrink-0 items-center gap-1" onMouseEnter={() => onOpenMega(null)}>
          <SearchBox variant="box" className="mr-2 w-56 xl:w-64" />
          <AccountMenu iconOnly />
          {showShopIcons && (
            <>
              <Button variant="ghost" size="icon" asChild><Link to="/wishlist" aria-label="Wishlist"><Heart className="size-5" /></Link></Button>
              <CartLink count={count} />
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}

function Header() {
  const { count } = useCart()
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const showShopIcons = !user || user.role === "customer"

  // mega menu: opens on hover / focus, closes shortly after the pointer leaves (so it can move into the panel)
  const [megaId, setMegaId] = useState(null)
  const closeTimer = useRef(null)
  const keepMega = () => clearTimeout(closeTimer.current)
  const openMega = (id) => { keepMega(); setMegaId(id) }
  const closeMega = () => { keepMega(); closeTimer.current = setTimeout(() => setMegaId(null), 150) }
  const location = useLocation()
  useEffect(() => setMegaId(null), [location.pathname, location.search])

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" onMouseLeave={closeMega}>
      <DesktopHeader count={count} showShopIcons={showShopIcons} megaId={megaId} onOpenMega={openMega} />
      {megaId && <div className="hidden lg:block"><MegaMenu categoryId={megaId} onClose={() => setMegaId(null)} onKeep={keepMega} /></div>}

      {/* phones and tablets */}
      <div className="container flex h-16 items-center gap-3 lg:hidden">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu"><Menu /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72">
            <SheetHeader><SheetTitle className="text-left">Shop by category</SheetTitle></SheetHeader>
            <CategoryNav className="mt-6 flex flex-col gap-4" onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>
        <Logo className="shrink-0" />
        <SearchBox className="ml-auto hidden w-full max-w-md md:ml-8 md:block" />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
          {showShopIcons && (
            <>
              <Button variant="ghost" size="icon" asChild className="hidden sm:inline-flex">
                <Link to="/wishlist" aria-label="Wishlist"><Heart /></Link>
              </Button>
              <CartLink count={count} />
            </>
          )}
        </div>
      </div>
      <div className="container pb-3 md:hidden">
        <SearchBox />
      </div>
    </header>
  )
}

function Footer() {
  const { data } = useStoreSettings()
  const store = data?.store
  return (
    <footer className="mt-16 border-t bg-zinc-950 text-zinc-300">
      <div className="container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          {/* the footer is always dark, so the light-ink logo is used in both themes */}
          <BrandLogo variant="stacked" tone="light-ink" className="h-24" />
          {store && <p className="text-sm leading-relaxed">{store.address}</p>}
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold text-white">Contact</h3>
          {store?.phones?.map((p) => (
            <a key={p} href={`tel:+91${p.replace(/\s/g, "")}`} className="flex items-center gap-2 hover:text-white"><Phone className="size-4" />{p}</a>
          ))}
          {store?.email && <a href={`mailto:${store.email}`} className="block hover:text-white">{store.email}</a>}
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold text-white">Help</h3>
          <Link to="/shipping" className="block hover:text-white">Shipping policy</Link>
          <Link to="/returns" className="block hover:text-white">Returns & refunds</Link>
          <Link to="/account/orders" className="block hover:text-white">Track your order</Link>
          <Link to="/contact" className="block hover:text-white">Contact us</Link>
          <Link to="/store-finder" className="block hover:text-white">Store finder</Link>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold text-white">Company</h3>
          <Link to="/about" className="block hover:text-white">About us</Link>
          <Link to="/privacy" className="block hover:text-white">Privacy policy</Link>
          <Link to="/terms" className="block hover:text-white">Terms & conditions</Link>
          <Link to="/admin/login" className="block hover:text-white">Staff login</Link>
        </div>
      </div>
      <div className="border-t border-zinc-800 py-4 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} Great Foot Wear{store?.gstin ? ` · GSTIN ${store.gstin}` : ""}
      </div>
    </footer>
  )
}

export function StoreLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:p-2">Skip to content</a>
      <OfferStrip />
      <Header />
      <main id="main" className="flex-1">
        <Suspense fallback={<PageLoader />}><Outlet /></Suspense>
      </main>
      <Footer />
    </div>
  )
}
