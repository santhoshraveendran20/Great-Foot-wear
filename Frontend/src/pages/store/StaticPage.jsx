import { FileQuestion } from "lucide-react"
import { Link } from "react-router-dom"

import { EmptyState, PageLoader, useDocumentTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { useGetStaticPageQuery } from "@/store/api/catalogApi"

/** About, Contact, Shipping, Returns, Privacy, Terms (AD-12, NF-06). Content is edited in Admin → Banners & pages. */
export function StaticPage({ slug }) {
  // currentData: never show the previous page's content while another slug loads
  const { currentData: data, isError } = useGetStaticPageQuery(slug)
  useDocumentTitle(data?.title)
  if (isError) return <NotFound />
  if (!data) return <PageLoader />
  return (
    <article className="container max-w-3xl py-10">
      <h1 className="mb-2 font-serif text-3xl font-bold">{data.title}</h1>
      <p className="mb-8 text-xs text-muted-foreground">Last updated {formatDate(data.updated_at)}</p>
      <div className="whitespace-pre-line leading-relaxed text-foreground/80">{data.content}</div>
    </article>
  )
}

export function NotFound() {
  useDocumentTitle("Page not found")
  return (
    <div className="container py-16">
      <EmptyState icon={FileQuestion} title="Page not found" description="The page you are looking for does not exist." action={<Button asChild><Link to="/">Go to home</Link></Button>} />
    </div>
  )
}
