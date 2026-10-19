import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, ShieldCheck } from "lucide-react"
import { useForm } from "react-hook-form"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { BrandLogo, PageLoader, useDocumentTitle } from "@/components/common"
import { passwordSchema } from "@/pages/store/Auth"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/store/auth"
import { useChangePasswordMutation } from "@/store/api/commonApi"
import { errorMessage } from "@/lib/api"

function Shell({ title, description, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4 dark:bg-background">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto"><BrandLogo variant="stacked" className="h-24" /></div>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

const field = (form, name, label, type = "text", props = {}) => (
  <FormField control={form.control} name={name} render={({ field: f }) => (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl><Input type={type} {...f} {...props} /></FormControl>
      <FormMessage />
    </FormItem>
  )} />
)

export function AdminLogin() {
  useDocumentTitle("Admin login")
  const { user, ready, login, logout } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const form = useForm({
    resolver: zodResolver(z.object({ identifier: z.string().min(3, "Enter email or mobile"), password: z.string().min(1, "Enter password") })),
    defaultValues: { identifier: "", password: "" },
  })
  if (!ready) return <PageLoader className="min-h-screen" />
  if (user && user.role !== "customer") return <Navigate to={user.must_change_password ? "/admin/change-password" : params.get("next") || "/admin"} replace />

  const onSubmit = async (v) => {
    try {
      const u = await login(v.identifier.trim(), v.password)
      if (u.role === "customer") {
        await logout()
        form.setError("root", { message: "This account does not have admin access." })
        return
      }
      navigate(u.must_change_password ? "/admin/change-password" : params.get("next") || "/admin", { replace: true })
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  return (
    <Shell title="Admin login" description="Great Foot Wear back office">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {form.formState.errors.root && <Alert variant="destructive"><AlertDescription>{form.formState.errors.root.message}</AlertDescription></Alert>}
          {field(form, "identifier", "Email or mobile", "text", { autoComplete: "username" })}
          {field(form, "password", "Password", "password", { autoComplete: "current-password" })}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Sign in
          </Button>
        </form>
      </Form>
    </Shell>
  )
}

/** UM-15: staff must change password on first login. */
export function AdminChangePassword() {
  useDocumentTitle("Change password")
  const { user, ready, setUser } = useAuth()
  const navigate = useNavigate()
  const [changePassword] = useChangePasswordMutation()
  const form = useForm({
    resolver: zodResolver(
      z.object({ current_password: z.string().min(1, "Enter your temporary password"), new_password: passwordSchema, confirm: z.string() })
        .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords do not match" })
    ),
    defaultValues: { current_password: "", new_password: "", confirm: "" },
  })
  if (!ready) return <PageLoader className="min-h-screen" />
  if (!user) return <Navigate to="/admin/login" replace />
  const onSubmit = async ({ confirm, ...v }) => {
    try {
      const data = await changePassword(v).unwrap()
      setUser(data)
      toast.success("Password updated")
      navigate("/admin", { replace: true })
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  return (
    <Shell title="Set a new password" description="For security, please change your temporary password before continuing.">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {form.formState.errors.root && <Alert variant="destructive"><AlertDescription>{form.formState.errors.root.message}</AlertDescription></Alert>}
          {field(form, "current_password", "Current (temporary) password", "password")}
          {field(form, "new_password", "New password", "password", { autoComplete: "new-password" })}
          {field(form, "confirm", "Confirm new password", "password", { autoComplete: "new-password" })}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}><ShieldCheck /> Update password</Button>
        </form>
      </Form>
    </Shell>
  )
}
