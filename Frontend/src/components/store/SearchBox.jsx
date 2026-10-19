import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { ProductImage } from "@/components/common"
import { Input } from "@/components/ui/input"
import { cn, formatINR } from "@/lib/utils"
import { useGetSearchSuggestionsQuery } from "@/store/api/catalogApi"

function useDebounced(value, delay = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

/** CT-05 search with auto-suggest. variant "box" = flat grey box with the icon on the right (desktop header). */
export function SearchBox({ className, onDone, variant = "default" }) {
  const box_ = variant === "box"
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get("q") || "")
  const [open, setOpen] = useState(false)
  const debounced = useDebounced(q.trim())
  const navigate = useNavigate()
  const box = useRef(null)

  const { currentData: data } = useGetSearchSuggestionsQuery(debounced, { skip: debounced.length < 2 })

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  const go = (path) => {
    setOpen(false)
    onDone?.()
    navigate(path)
  }

  const submit = (e) => {
    e.preventDefault()
    if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`)
  }

  const hasResults = data && (data.products.length || data.categories.length || data.brands.length)

  return (
    <div ref={box} className={className}>
      <form onSubmit={submit} role="search" className="relative">
        {!box_ && <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={box_ ? "Search" : "Search shoes, brands, categories"}
          className={cn(box_ ? "h-10 rounded-none border-0 bg-muted pl-3 pr-11 shadow-none focus-visible:ring-1" : "pl-9")}
          aria-label="Search products"
        />
        {box_ && (
          <button type="submit" aria-label="Search" className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-foreground/80 hover:text-foreground">
            <Search className="size-5" />
          </button>
        )}
        {open && debounced.length >= 2 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
            {!hasResults && <p className="p-3 text-sm text-muted-foreground">No matches. Press Enter to search.</p>}
            {data?.categories.map((c) => (
              <button type="button" key={`c-${c.slug}`} onClick={() => go(`/category/${c.slug}`)} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="text-muted-foreground">Category: </span>{c.name}
              </button>
            ))}
            {data?.brands.map((b) => (
              <button type="button" key={`b-${b.slug}`} onClick={() => go(`/search?q=${encodeURIComponent(b.name)}`)} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="text-muted-foreground">Brand: </span>{b.name}
              </button>
            ))}
            {data?.products.map((p) => (
              <button type="button" key={p.slug} onClick={() => go(`/product/${p.slug}`)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="size-9 shrink-0 overflow-hidden rounded bg-muted"><ProductImage src={p.image} alt="" /></span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-muted-foreground">{formatINR(p.price)}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  )
}
