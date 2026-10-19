import { useEffect, useMemo, useState } from "react"
import { Download, FileDown, KeyRound, Plus, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { DataTable, PageHeader, Pager } from "@/components/admin/ui"
import { ImageUpload } from "@/components/admin/ImageUpload"
import { PageLoader, useDocumentTitle } from "@/components/common"
import { passwordSchema } from "@/pages/store/Auth"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/store/auth"
import {
  useCreateAdminStaffMutation,
  useGetAdminAuditLogsQuery,
  useGetAdminReportQuery,
  useGetAdminSettingsQuery,
  useGetAdminStaffQuery,
  useSaveAdminSettingsMutation,
  useUpdateAdminStaffMutation,
} from "@/store/api/adminBusinessApi"
import { downloadFile, errorMessage } from "@/lib/api"
import { formatDate } from "@/lib/utils"

function F({ label, hint, children, className }) {
  return (
    <div className={`space-y-2 ${className || ""}`}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ------------------------------------------------------------------ Reports (AD-15)

const REPORTS = [
  { value: "sales_by_day", label: "Sales by day" },
  { value: "sales_by_product", label: "Sales by product" },
  { value: "sales_by_category", label: "Sales by category" },
  { value: "gst", label: "GST report" },
  { value: "payment_split", label: "Payment method split" },
  { value: "stock_valuation", label: "Stock valuation" },
  { value: "reconciliation", label: "Payment reconciliation" },
]

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function AdminReports() {
  useDocumentTitle("Reports")
  const [kind, setKind] = useState("sales_by_day")
  const [from, setFrom] = useState(isoDaysAgo(29))
  const [to, setTo] = useState(isoDaysAgo(0))
  const params = { date_from: from, date_to: to }
  const { data, isLoading, isError, error } = useGetAdminReportQuery({ kind, ...params })
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Sales count orders that are confirmed and not cancelled. GST report lists invoiced orders."
        actions={
          <>
            <Button variant="outline" onClick={() => downloadFile(`/admin/reports/${kind}`, `${kind}.csv`, { ...params, format: "csv" })}><Download /> CSV</Button>
            <Button variant="outline" onClick={() => downloadFile(`/admin/reports/${kind}`, `${kind}.pdf`, { ...params, format: "pdf" })}><FileDown /> PDF</Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <F label="Report">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{REPORTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        {kind !== "stock_valuation" && (
          <>
            <F label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" /></F>
            <F label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" /></F>
          </>
        )}
      </div>
      {isError ? (
        <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>
      ) : (
        <DataTable
          loading={isLoading}
          rows={data?.rows?.map((r, i) => ({ id: i, cells: r }))}
          columns={(data?.headers || []).map((h, i) => ({ key: String(i), header: h, cell: (row) => row.cells[i] }))}
          empty="No data for this period"
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Staff users (UM-15)

function StaffDialog({ onClose }) {
  const [v, setV] = useState({ name: "", email: "", mobile: "", role: "staff", temp_password: "" })
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const pwOk = passwordSchema.safeParse(v.temp_password).success
  const [createStaff, { isLoading: saving }] = useCreateAdminStaffMutation()
  const save = () =>
    createStaff(v)
      .unwrap()
      .then(() => { toast.success("Staff account created. Share the temporary password securely."); onClose() })
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add staff user</DialogTitle>
          <DialogDescription>They must change the temporary password on first login.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Name"><Input value={v.name} onChange={set("name")} /></F>
          <F label="Mobile"><Input value={v.mobile} onChange={set("mobile")} inputMode="numeric" maxLength={10} /></F>
          <F label="Email" className="sm:col-span-2"><Input type="email" value={v.email} onChange={set("email")} /></F>
          <F label="Role">
            <Select value={v.role} onValueChange={set("role")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="staff">Staff (order / stock manager)</SelectItem><SelectItem value="admin">Super Admin</SelectItem></SelectContent>
            </Select>
          </F>
          <F label="Temporary password" hint="8+ characters, 1 letter and 1 number"><Input value={v.temp_password} onChange={set("temp_password")} /></F>
        </div>
        <DialogFooter><Button onClick={save} disabled={!v.name || !v.email || !/^[6-9]\d{9}$/.test(v.mobile) || !pwOk || saving}>Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ staff, onClose }) {
  const [pw, setPw] = useState("")
  const [updateStaff, { isLoading: saving }] = useUpdateAdminStaffMutation()
  const save = () =>
    updateStaff({ id: staff.id, reset_password: pw })
      .unwrap()
      .then(() => { toast.success("Password reset. They must change it on next login."); onClose() })
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset password for {staff.name}</DialogTitle></DialogHeader>
        <F label="New temporary password" hint="8+ characters, 1 letter and 1 number"><Input value={pw} onChange={(e) => setPw(e.target.value)} /></F>
        <DialogFooter><Button onClick={save} disabled={!passwordSchema.safeParse(pw).success || saving}>Reset</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminStaff() {
  useDocumentTitle("Staff users")
  const { user } = useAuth()
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState(null)
  const { data, isLoading } = useGetAdminStaffQuery(undefined)
  const [updateStaff] = useUpdateAdminStaffMutation()
  const update = (arg) =>
    updateStaff(arg)
      .unwrap()
      .then(() => toast.success("Updated"))
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <div>
      <PageHeader title="Staff users" description="Create staff, assign role, deactivate" actions={<Button onClick={() => setAdding(true)}><Plus /> Add staff</Button>} />
      <DataTable
        loading={isLoading}
        rows={data}
        columns={[
          { key: "name", header: "Name", cell: (s) => <div><p className="font-medium">{s.name}{s.id === user.id && " (you)"}</p><p className="text-xs text-muted-foreground">{s.email} · {s.mobile}</p></div> },
          {
            key: "role", header: "Role",
            cell: (s) => (
              <Select value={s.role} onValueChange={(role) => update({ id: s.id, role })} disabled={s.id === user.id}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="admin">Super Admin</SelectItem></SelectContent>
              </Select>
            ),
          },
          { key: "pw", header: "Password", cell: (s) => (s.must_change_password ? <Badge variant="warning">Must change</Badge> : <Badge variant="outline">Set</Badge>) },
          { key: "is_active", header: "Active", cell: (s) => <Switch checked={s.is_active} disabled={s.id === user.id} onCheckedChange={(is_active) => update({ id: s.id, is_active })} aria-label="Active" /> },
          { key: "created_at", header: "Created", cell: (s) => formatDate(s.created_at) },
          { key: "actions", header: "", className: "text-right", cell: (s) => s.id !== user.id && <Button variant="outline" size="sm" onClick={() => setResetting(s)}><KeyRound /> Reset password</Button> },
        ]}
      />
      {adding && <StaffDialog onClose={() => setAdding(false)} />}
      {resetting && <ResetPasswordDialog staff={resetting} onClose={() => setResetting(null)} />}
    </div>
  )
}

// ------------------------------------------------------------------ Audit log (UM-17)

export function AdminAuditLog() {
  useDocumentTitle("Audit log")
  const [page, setPage] = useState(1)
  const { data, isLoading } = useGetAdminAuditLogsQuery(page)
  return (
    <div>
      <PageHeader title="Audit log" description="Who did what, and when, in the admin panel" />
      <DataTable
        loading={isLoading}
        rows={data?.items}
        columns={[
          { key: "created_at", header: "When", cell: (a) => formatDate(a.created_at, true) },
          { key: "user", header: "User", cell: (a) => a.user || "System" },
          { key: "action", header: "Action", cell: (a) => <Badge variant="outline">{a.action}</Badge> },
          { key: "entity", header: "Record", cell: (a) => `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ""}` },
          { key: "details", header: "Details", cell: (a) => <code className="line-clamp-2 max-w-md text-xs text-muted-foreground">{a.details ? JSON.stringify(a.details) : ""}</code> },
          { key: "ip", header: "IP", cell: (a) => <span className="text-xs">{a.ip}</span> },
        ]}
      />
      <Pager page={page} pageSize={data?.page_size || 50} total={data?.total} onPage={setPage} />
    </div>
  )
}

// ------------------------------------------------------------------ Settings (AD-14, AD-16, PY-12)

const listToText = (l) => (l || []).join(", ")
const textToList = (t) => t.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
const numOrNull = (x) => (x === "" || x === null || x === undefined ? null : Number(x))

function SettingsSection({ group, title, description, initial, toBody, children }) {
  const [v, setV] = useState(initial)
  useEffect(() => {
    setV(initial)
  }, [initial])
  const [saveSettings, { isLoading: saving }] = useSaveAdminSettingsMutation()
  const save = () =>
    saveSettings({ group, body: toBody ? toBody(v) : v })
      .unwrap()
      .then(() => toast.success(`${title} saved`))
      .catch((e) => toast.error(errorMessage(e)))
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }))
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
      <CardContent className="space-y-4">
        {children(v, set, setV)}
        <Button onClick={save} disabled={saving}>Save</Button>
      </CardContent>
    </Card>
  )
}

export function AdminSettings() {
  useDocumentTitle("Settings")
  const { data, isLoading } = useGetAdminSettingsQuery(undefined)
  const forms = useMemo(() => data && {
    store: { ...data.store, phones: listToText(data.store.phones) },
    shipping: { ...data.shipping, serviceable_pincodes: listToText(data.shipping.serviceable_pincodes), free_shipping_threshold: data.shipping.free_shipping_threshold ?? "" },
    cod: { ...data.cod, blocked_pincodes: listToText(data.cod.blocked_pincodes), max_order_value: data.cod.max_order_value ?? "" },
    alerts: { emails: listToText(data.admin_alerts.emails), mobiles: listToText(data.admin_alerts.mobiles) },
  }, [data])
  if (isLoading) return <PageLoader />
  const { store, shipping, cod, alerts } = forms

  return (
    <div>
      <PageHeader title="Settings" description="Store details, shipping & COD rules, payment gateway mode and notifications" />
      <Tabs defaultValue="store">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="store">Store</TabsTrigger>
          <TabsTrigger value="shipping">Shipping & COD</TabsTrigger>
          <TabsTrigger value="payment">Payments</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="store">
          <SettingsSection group="store" title="Store details" description="Shown on invoices, footer and contact page" initial={store} toBody={(v) => ({ ...v, phones: v.phones.split(",").map((p) => p.trim()).filter(Boolean) })}>
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <F label="Store name"><Input value={v.name} onChange={set("name")} /></F>
                <F label="GSTIN" hint="Printed on every GST invoice"><Input value={v.gstin} onChange={(e) => set("gstin")(e.target.value.toUpperCase())} maxLength={15} /></F>
                <F label="Address" className="sm:col-span-2"><Textarea rows={2} value={v.address} onChange={set("address")} /></F>
                <F label="City"><Input value={v.city} onChange={set("city")} /></F>
                <F label="PIN code"><Input value={v.pincode} onChange={set("pincode")} maxLength={6} /></F>
                <F label="State" hint="Orders to this state get CGST + SGST; others IGST"><Input value={v.state} onChange={set("state")} /></F>
                <F label="State code"><Input value={v.state_code} onChange={set("state_code")} maxLength={2} /></F>
                <F label="Phone numbers (comma separated)"><Input value={v.phones} onChange={set("phones")} /></F>
                <F label="Email"><Input type="email" value={v.email} onChange={set("email")} /></F>
                <F label="Logo" className="sm:col-span-2"><ImageUpload value={v.logo_url || null} onChange={(url) => set("logo_url")(url || "")} folder="store" /></F>
                <F label="Google Maps link" className="sm:col-span-2" hint="Share link of the shop on Google Maps; used for “Get directions” on the store finder page">
                  <Input value={v.map_url || ""} onChange={set("map_url")} placeholder="https://maps.app.goo.gl/…" />
                </F>
                <F label="Google Maps listing ID (CID)" className="sm:col-span-2" hint="Numbers only. Shows the shop's name, address and rating on the map; leave empty to show a plain pin at the latitude / longitude below.">
                  <Input value={v.map_cid || ""} onChange={(e) => set("map_cid")(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
                </F>
                <F label="Map latitude" hint="Pin position on the store finder map"><Input value={v.map_lat ?? ""} onChange={set("map_lat")} inputMode="decimal" /></F>
                <F label="Map longitude"><Input value={v.map_lng ?? ""} onChange={set("map_lng")} inputMode="decimal" /></F>
                <F label="Opening hours" className="sm:col-span-2" hint="One line per day or range, e.g. Mon–Sat: 10:00–21:00. Leave empty to hide.">
                  <Textarea rows={3} value={v.opening_hours || ""} onChange={set("opening_hours")} />
                </F>
              </div>
            )}
          </SettingsSection>
        </TabsContent>

        <TabsContent value="shipping" className="space-y-6">
          <SettingsSection
            group="shipping" title="Shipping" initial={shipping}
            toBody={(v) => ({
              ...v, flat_fee: Number(v.flat_fee || 0), free_shipping_threshold: numOrNull(v.free_shipping_threshold),
              delivery_days_min: Number(v.delivery_days_min || 0), delivery_days_max: Number(v.delivery_days_max || 0), serviceable_pincodes: textToList(v.serviceable_pincodes),
            })}
          >
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <F label="Flat shipping fee (₹)"><Input type="number" min={0} value={v.flat_fee} onChange={set("flat_fee")} /></F>
                <F label="Free shipping above (₹)" hint="Leave empty for no free-shipping rule"><Input type="number" min={0} value={v.free_shipping_threshold} onChange={set("free_shipping_threshold")} /></F>
                <F label="Delivery days – minimum"><Input type="number" min={0} value={v.delivery_days_min} onChange={set("delivery_days_min")} /></F>
                <F label="Delivery days – maximum"><Input type="number" min={0} value={v.delivery_days_max} onChange={set("delivery_days_max")} /></F>
                <F label="Serviceable PIN codes" hint="Comma or space separated. Leave empty to deliver to all PIN codes." className="sm:col-span-2">
                  <Textarea rows={3} value={v.serviceable_pincodes} onChange={set("serviceable_pincodes")} />
                </F>
                <div className="flex items-center gap-2"><Switch id="pk" checked={v.pickup_enabled} onCheckedChange={set("pickup_enabled")} /><Label htmlFor="pk">Allow store pickup at Manali</Label></div>
              </div>
            )}
          </SettingsSection>
          <SettingsSection
            group="cod" title="Cash on Delivery" initial={cod}
            toBody={(v) => ({ ...v, fee: Number(v.fee || 0), max_order_value: numOrNull(v.max_order_value), blocked_pincodes: textToList(v.blocked_pincodes) })}
          >
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-2 sm:col-span-2"><Switch id="ce" checked={v.enabled} onCheckedChange={set("enabled")} /><Label htmlFor="ce">COD enabled</Label></div>
                <F label="Maximum order value for COD (₹)" hint="Leave empty for no limit"><Input type="number" min={0} value={v.max_order_value} onChange={set("max_order_value")} /></F>
                <F label="COD fee (₹)"><Input type="number" min={0} value={v.fee} onChange={set("fee")} /></F>
                <F label="PIN codes where COD is blocked" className="sm:col-span-2"><Textarea rows={2} value={v.blocked_pincodes} onChange={set("blocked_pincodes")} /></F>
              </div>
            )}
          </SettingsSection>
          <SettingsSection group="returns" title="Returns" initial={data.returns} toBody={(v) => ({ window_days: Number(v.window_days || 0) })}>
            {(v, set) => <F label="Return / exchange window (days after delivery)"><Input type="number" min={0} className="w-32" value={v.window_days} onChange={set("window_days")} /></F>}
          </SettingsSection>
        </TabsContent>

        <TabsContent value="payment">
          <SettingsSection group="payment" title="Payment gateway (Razorpay)" description="API keys are stored only in the server environment (.env), never here." initial={data.payment}>
            {(v, set) => (
              <div className="space-y-4">
                {!data.gateway_status.configured && (
                  <Alert variant="destructive">
                    <ShieldAlert className="size-4" />
                    <AlertTitle>Razorpay {v.gateway_mode} keys are not set</AlertTitle>
                    <AlertDescription>Add RAZORPAY_{v.gateway_mode.toUpperCase()}_KEY_ID and _KEY_SECRET to the backend .env. Until then customers can only use COD.</AlertDescription>
                  </Alert>
                )}
                <F label="Mode">
                  <Select value={v.gateway_mode} onValueChange={set("gateway_mode")}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="test">Test mode</SelectItem><SelectItem value="live">Live mode</SelectItem></SelectContent>
                  </Select>
                </F>
                <div className="flex items-center gap-2"><Switch id="oe" checked={v.online_enabled} onCheckedChange={set("online_enabled")} /><Label htmlFor="oe">Accept online payments (UPI, cards, net banking, wallets)</Label></div>
              </div>
            )}
          </SettingsSection>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <SettingsSection group="admin_alerts" title="Admin alerts" description="Who gets an email / SMS on every new order and low stock" initial={alerts} toBody={(v) => ({ emails: textToList(v.emails), mobiles: textToList(v.mobiles) })}>
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <F label="Alert emails (comma separated)"><Input value={v.emails} onChange={set("emails")} /></F>
                <F label="Alert mobile numbers (comma separated)"><Input value={v.mobiles} onChange={set("mobiles")} /></F>
              </div>
            )}
          </SettingsSection>
          <SettingsSection group="notification_templates" title="Customer message templates" description="Placeholders: {name}, {order_no}, {total}, {status}, {note}, {amount}" initial={data.notification_templates}>
            {(v, set, setV) => (
              <div className="space-y-6">
                {Object.entries(v).map(([key, tpl]) => (
                  <div key={key} className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">{{ order_placed: "Order placed", order_status: "Order status change", refund: "Refund" }[key] || key}</p>
                    <Input value={tpl.subject} onChange={(e) => setV((s) => ({ ...s, [key]: { ...s[key], subject: e.target.value } }))} aria-label="Subject" />
                    <Textarea rows={2} value={tpl.body} onChange={(e) => setV((s) => ({ ...s, [key]: { ...s[key], body: e.target.value } }))} aria-label="Message" />
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>
        </TabsContent>
      </Tabs>
    </div>
  )
}
