
import { Fragment } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Dashboard figure. With onClick the whole card is a button (opens the details panel). */
export function StatCard({ title, value, hint, icon: Icon, onClick }) {
  const card = (
    <Card className={onClick ? "h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/40" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2 sm:p-6 sm:pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="text-xl font-bold sm:text-2xl">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {onClick && <p className="mt-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">View details →</p>}
      </CardContent>
    </Card>
  )
  if (!onClick) return card
  return (
    <button type="button" onClick={onClick} className="group rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${title}: ${value}. View details`}>
      {card}
    </button>
  )
}

/**
 * Simple data table on shadcn/ui Table. On phones each row is shown as a card instead.
 * columns: [{ key, header, cell?: (row) => node, className? }]
 */
export function DataTable({ columns, rows, loading, empty = "No records found", onRowClick, rowKey = "id" }) {
  const isMobile = useIsMobile()
  if (isMobile) return <DataCards columns={columns} rows={rows} loading={loading} empty={empty} onRowClick={onRowClick} rowKey={rowKey} />
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => <TableHead key={c.key} className={c.className}>{c.header}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={columns.length} className="h-24 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
          ) : !rows?.length ? (
            <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">{empty}</TableCell></TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={r[rowKey] ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn(onRowClick && "cursor-pointer")}>
                {columns.map((c) => <TableCell key={c.key} className={c.className}>{c.cell ? c.cell(r) : r[c.key]}</TableCell>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Phone layout of DataTable: a leading column without a header (image) sits beside the first
 * labelled column (title); other labelled columns become label / value lines; trailing columns
 * without a header (actions) go at the bottom.
 */
function DataCards({ columns, rows, loading, empty, onRowClick, rowKey }) {
  if (loading) return <div className="grid h-24 place-items-center rounded-md border bg-card"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  if (!rows?.length) return <div className="grid h-24 place-items-center rounded-md border bg-card px-4 text-center text-sm text-muted-foreground">{empty}</div>

  const media = columns[0]?.header ? null : columns[0]
  const labelled = columns.filter((c) => c.header)
  const trailing = columns.filter((c) => !c.header && c !== media)
  const [title, ...fields] = labelled
  const render = (c, r) => (c.cell ? c.cell(r) : r[c.key])

  return (
    <ul className="divide-y rounded-md border bg-card">
      {rows.map((r, i) => (
        <li
          key={r[rowKey] ?? i}
          onClick={onRowClick ? () => onRowClick(r) : undefined}
          className={cn("space-y-3 p-4 text-sm", onRowClick && "cursor-pointer active:bg-muted/50")}
        >
          {(media || title) && (
            <div className="flex items-start gap-3">
              {media && <div className="shrink-0">{render(media, r)}</div>}
              {title && <div className="min-w-0 flex-1 break-words">{render(title, r)}</div>}
            </div>
          )}
          {fields.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              {fields.map((c) => (
                <Fragment key={c.key}>
                  <dt className="text-muted-foreground">{c.header}</dt>
                  <dd className="break-words text-right">{render(c, r)}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {trailing.map((c) => <div key={c.key} className="flex flex-wrap justify-end gap-2">{render(c, r)}</div>)}
        </li>
      ))}
    </ul>
  )
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize))
  if (pages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>{total} records</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  )
}
