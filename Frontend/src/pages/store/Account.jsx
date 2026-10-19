import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Heart, MapPin, Package, Pencil, Plus, Star, Trash2, User } from "lucide-react"
import { useForm } from "react-hook-form"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { EmptyState, PageLoader, useDocumentTitle } from "@/components/common"
import { AddressDialog } from "@/components/store/AddressForm"
import { EmailPending, mobileSchema, passwordSchema } from "@/pages/store/Auth"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/store/auth"
import { useDeleteMyAccountMutation, useUpdateMyPreferencesMutation, useUpdateMyProfileMutation } from "@/store/api/accountApi"
import { useChangePasswordMutation, useDeleteAddressMutation, useGetAddressesQuery, useSetDefaultAddressMutation } from "@/store/api/commonApi"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/account", label: "Profile", icon: User, end: true },
  { to: "/account/orders", label: "My orders", icon: Package },
  { to: "/account/addresses", label: "Addresses", icon: MapPin },
  { to: "/wishlist", label: "Wishlist", icon: Heart },
]

export function AccountLayout() {
  return (
    <div className="container py-6">
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto no-scrollbar md:flex-col" aria-label="Account">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cn("flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium hover:bg-accent", isActive && "bg-accent text-primary")}
            >
              <n.icon className="size-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </div>
  )
}

function Text({ form, name, label, ...props }) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl><Input {...field} value={field.value ?? ""} {...props} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  )
}

function ProfileForm() {
  const { user, setUser } = useAuth()
  const [updateProfile] = useUpdateMyProfileMutation()
  const form = useForm({
    resolver: zodResolver(z.object({
      name: z.string().trim().min(2, "Enter your name"),
      email: z.string().trim().email("Enter a valid email"),
      mobile: mobileSchema,
      gender: z.string().optional().nullable(),
      date_of_birth: z.string().optional().nullable(),
    })),
    defaultValues: { name: user.name, email: user.email, mobile: user.mobile, gender: user.gender || "", date_of_birth: user.date_of_birth || "" },
  })
  const onSubmit = async (v) => {
    try {
      const data = await updateProfile({ ...v, gender: v.gender || null, date_of_birth: v.date_of_birth || null }).unwrap()
      setUser(data)
      toast.success(data.mobile_verified ? "Profile updated" : "Profile updated. Please verify your new mobile number.")
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Profile</CardTitle>
        <CardDescription>Changing your mobile or email needs re-verification.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
            {form.formState.errors.root && <p className="text-sm text-destructive sm:col-span-2">{form.formState.errors.root.message}</p>}
            <Text form={form} name="name" label="Full name" />
            <Text form={form} name="mobile" label="Mobile number" inputMode="numeric" maxLength={10} />
            <div className="sm:col-span-2"><Text form={form} name="email" label="Email" type="email" /></div>
            <FormField control={form.control} name="gender" render={({ field }) => (
              <FormItem>
                <FormLabel>Gender (optional)</FormLabel>
                <Select value={field.value || ""} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <Text form={form} name="date_of_birth" label="Date of birth (optional)" type="date" />
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Badge variant={user.mobile_verified ? "success" : "warning"}>Mobile {user.mobile_verified ? "verified" : "not verified"}</Badge>
              <Badge variant={user.email_verified ? "success" : "warning"}>Email {user.email_verified ? "verified" : "not verified"}</Badge>
              {!user.mobile_verified && <Button variant="link" size="sm" asChild><NavLink to="/verify-otp?next=/account">Verify mobile</NavLink></Button>}
            </div>
            <Button type="submit" className="sm:col-span-2 sm:w-40" disabled={form.formState.isSubmitting}>Save changes</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

function PasswordForm() {
  const [changePassword] = useChangePasswordMutation()
  const form = useForm({
    resolver: zodResolver(z.object({ current_password: z.string().min(1, "Enter current password"), new_password: passwordSchema })),
    defaultValues: { current_password: "", new_password: "" },
  })
  const onSubmit = async (v) => {
    try {
      await changePassword(v).unwrap()
      form.reset()
      toast.success("Password changed")
    } catch (e) {
      form.setError("current_password", { message: errorMessage(e) })
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Change password</CardTitle></CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
            <Text form={form} name="current_password" label="Current password" type="password" autoComplete="current-password" />
            <Text form={form} name="new_password" label="New password" type="password" autoComplete="new-password" />
            <Button type="submit" className="sm:w-40" disabled={form.formState.isSubmitting}>Update password</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

function Preferences() {
  const { user, setUser } = useAuth()
  const [savePreferences] = useUpdateMyPreferencesMutation()
  const save = (patch) =>
    savePreferences({ promo_email: user.promo_email, promo_sms: user.promo_sms, promo_whatsapp: user.promo_whatsapp, ...patch })
      .unwrap()
      .then((data) => { setUser(data); toast.success("Preferences saved") })
      .catch(() => {})
  const row = (key, label) => (
    <div className="flex items-center justify-between">
      <Label htmlFor={key} className="font-normal">{label}</Label>
      <Switch id={key} checked={user[key]} onCheckedChange={(v) => save({ [key]: v })} />
    </div>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Notification preferences</CardTitle>
        <CardDescription>Order updates are always sent. Choose where you'd like offers and promotions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {row("promo_email", "Promotions by email")}
        {row("promo_sms", "Promotions by SMS")}
        {row("promo_whatsapp", "Promotions on WhatsApp")}
      </CardContent>
    </Card>
  )
}

function DeleteAccount() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [deleteAccount, { isLoading: deleting }] = useDeleteMyAccountMutation()
  const del = () =>
    deleteAccount(password)
      .unwrap()
      .then(async () => {
        toast.success("Your account has been deleted")
        await logout()
        navigate("/")
      })
      .catch((e) => toast.error(errorMessage(e)))
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-lg">Delete account</CardTitle>
        <CardDescription>Your personal data will be anonymised. Order records are kept as required for GST and accounting.</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="destructive">Delete my account</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone. Enter your password to confirm.</AlertDialogDescription>
            </AlertDialogHeader>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={!password || deleting} onClick={(e) => { e.preventDefault(); del() }}>
                Delete account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

export function AccountProfile() {
  useDocumentTitle("My account")
  return (
    <div className="space-y-6">
      <EmailPending />
      <ProfileForm />
      <PasswordForm />
      <Preferences />
      <DeleteAccount />
    </div>
  )
}

export function Addresses() {
  useDocumentTitle("My addresses")
  const [editing, setEditing] = useState(null)
  // AddressDialog's saveAddress, deleteAddress and setDefaultAddress all invalidate "Addresses"
  const { data = [], isLoading } = useGetAddressesQuery()
  const [deleteAddress] = useDeleteAddressMutation()
  const [setDefaultAddress] = useSetDefaultAddressMutation()
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-bold">Addresses</h1>
        <Button onClick={() => setEditing({})}><Plus /> Add address</Button>
      </div>
      {!data.length ? (
        <EmptyState icon={MapPin} title="No saved addresses" description="Add an address for faster checkout." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.name}</span>
                  {a.is_default && <Badge variant="info"><Star className="mr-1 size-3" /> Default</Badge>}
                </div>
                <p className="text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.state} – {a.pincode}<br />Mobile: {a.mobile}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(a)}><Pencil /> Edit</Button>
                  {!a.is_default && <Button variant="outline" size="sm" onClick={() => setDefaultAddress(a.id)}>Set default</Button>}
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteAddress(a.id)}><Trash2 /> Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <AddressDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} address={editing?.id ? editing : null} />
    </div>
  )
}
