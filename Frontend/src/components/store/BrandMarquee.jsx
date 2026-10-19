// Logos live in public/brands (cut from the owner's brand sheet)
const BRANDS = [
  ["ugg", "UGG"], ["jordan", "Jordan"], ["toms", "TOMS"], ["crocs", "Crocs"], ["merrell", "Merrell"],
  ["hush-puppies", "Hush Puppies"], ["columbia", "Columbia"], ["brooks", "Brooks"], ["timberland", "Timberland"],
  ["lacoste", "Lacoste"], ["adidas", "adidas"], ["mizuno", "Mizuno"], ["wilson", "Wilson"], ["dc-shoes", "DC Shoes"],
  ["fila", "FILA"], ["wolf-and-shepherd", "Wolf & Shepherd"], ["new-balance", "New Balance"], ["skechers", "Skechers"],
  ["h-and-m", "H&M"], ["puma", "PUMA"], ["vans", "Vans"], ["lotto", "Lotto"], ["onitsuka-tiger", "Onitsuka Tiger"],
  ["diadora", "Diadora"], ["under-armour", "Under Armour"], ["giovanni-fabiani", "Giovanni Fabiani"], ["bata", "Bata"],
  ["reebok", "Reebok"], ["hoka", "HOKA"], ["oofos", "OOFOS"], ["ozark-trail", "Ozark Trail"],
  ["beckett-simonon", "Beckett Simonon"], ["sanuk", "Sanuk"], ["sperry", "Sperry"], ["dr-martens", "Dr. Martens"],
  ["asics", "ASICS"], ["nike", "Nike"], ["umbro", "Umbro"], ["converse", "Converse"], ["saucony", "Saucony"],
  ["kappa", "Kappa"], ["burberry", "Burberry"],
]

function LogoRow({ hidden }) {
  // each item carries its own horizontal padding (not a flex gap) so the two copies are exactly equal
  // in width and the -50% loop is seamless
  return (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {BRANDS.map(([slug, name]) => (
        <li key={slug} className="flex h-20 shrink-0 items-center px-5 md:h-24 md:px-8">
          {/* a box tall enough for square marks and narrow enough for wide wordmarks keeps them visually even */}
          <img
            src={`/brands/${slug}.png`}
            alt={hidden ? "" : name}
            loading="lazy"
            draggable="false"
            className="max-h-11 w-auto max-w-[100px] object-contain md:max-h-14 md:max-w-[130px]"
          />
        </li>
      ))}
    </ul>
  )
}

export function BrandMarquee() {
  return (
    <section aria-label="Brands" className="border-y bg-white dark:bg-zinc-100">
      <div className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div
          className="flex w-max animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none"
          style={{ "--marquee-duration": "90s" }}
        >
          <LogoRow />
          <LogoRow hidden />
        </div>
      </div>
    </section>
  )
}
