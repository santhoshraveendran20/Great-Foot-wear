import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CheckCircle2, Loader2, MailCheck, XCircle } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { Logo, PageLoader, useDocumentTitle } from "@/components/common"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/store/auth"
import {
  useForgotPasswordMutation,
  useLazyGetCurrentUserQuery,
  useResendEmailVerificationMutation,
  useResetPasswordMutation,
  useSendOtpMutation,
  useVerifyEmailMutation,
  useVerifyOtpMutation,
} from "@/store/api/accountApi"
import { errorMessage } from "@/lib/api"

export const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(72, "Too long")
  .regex(/[A-Za-z]/, "Include at least 1 letter")
  .regex(/\d/, "Include at least 1 number")
export const mobileSchema = z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number")
const otpSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit OTP")

function AuthCard({ title, description, children, footer }) {
  return (
    <div className="container flex min-h-[70vh] items-center justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <Logo compact className="mx-auto" />
          <CardTitle className="text-2xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer && <CardFooter className="justify-center text-sm text-muted-foreground">{footer}</CardFooter>}
      </Card>
    </div>
  )
}

function Field({ form, name, label, type = "text", ...props }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl><Input type={type} {...field} {...props} /></FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function useAfterLogin() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (user) => {
    if (user.role !== "customer") return navigate("/admin")
    if (!user.mobile_verified) return navigate(`/verify-otp?next=${encodeURIComponent(params.get("next") || "/")}`)
    navigate(params.get("next") || "/")
  }
}

function PasswordLogin() {
  const { login } = useAuth()
  const after = useAfterLogin()
  const form = useForm({
    resolver: zodResolver(z.object({ identifier: z.string().min(3, "Enter your email or mobile"), password: z.string().min(1, "Enter your password") })),
    defaultValues: { identifier: "", password: "" },
  })
  const onSubmit = async (v) => {
    try {
      after(await login(v.identifier.trim(), v.password))
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {form.formState.errors.root && <Alert variant="destructive"><AlertDescription>{form.formState.errors.root.message}</AlertDescription></Alert>}
        <Field form={form} name="identifier" label="Email or mobile number" autoComplete="username" />
        <Field form={form} name="password" label="Password" type="password" autoComplete="current-password" />
        <div className="text-right"><Link to="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link></div>
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Login
        </Button>
      </form>
    </Form>
  )
}

function OtpLogin() {
  const { otpLogin } = useAuth()
  const after = useAfterLogin()
  const [sent, setSent] = useState(false)
  const [sendOtp] = useSendOtpMutation()
  const form = useForm({ resolver: zodResolver(z.object({ mobile: mobileSchema, code: z.string().optional() })), defaultValues: { mobile: "", code: "" } })
  const onSubmit = async (v) => {
    try {
      if (!sent) {
        await sendOtp({ mobile: v.mobile, purpose: "login" }).unwrap()
        setSent(true)
        toast.success("If this number is registered, an OTP has been sent")
        return
      }
      if (!/^\d{6}$/.test(v.code || "")) return form.setError("code", { message: "Enter the 6-digit OTP" })
      after(await otpLogin(v.mobile, v.code))
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {form.formState.errors.root && <Alert variant="destructive"><AlertDescription>{form.formState.errors.root.message}</AlertDescription></Alert>}
        <Field form={form} name="mobile" label="Mobile number" inputMode="numeric" maxLength={10} disabled={sent} />
        {sent && <Field form={form} name="code" label="OTP" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" />} {sent ? "Verify & login" : "Send OTP"}
        </Button>
        {sent && <Button type="button" variant="link" className="w-full" onClick={() => setSent(false)}>Change number</Button>}
      </form>
    </Form>
  )
}

export function Login() {
  useDocumentTitle("Login")
  const { user } = useAuth()
  const [params] = useSearchParams()
  if (user) return <Navigate to={user.role === "customer" ? params.get("next") || "/" : "/admin"} replace />
  return (
    <AuthCard
      title="Welcome back"
      description="Login to your Great Foot Wear account"
      footer={<span>New here? <Link to={`/register${params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : ""}`} className="font-medium text-primary hover:underline">Create an account</Link></span>}
    >
      <Tabs defaultValue="password">
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="otp">OTP</TabsTrigger>
        </TabsList>
        <TabsContent value="password"><PasswordLogin /></TabsContent>
        <TabsContent value="otp"><OtpLogin /></TabsContent>
      </Tabs>
    </AuthCard>
  )
}

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name").max(120),
    mobile: mobileSchema,
    email: z.string().trim().email("Enter a valid email"),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" })

export function Register() {
  useDocumentTitle("Create account")
  const { register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const form = useForm({ resolver: zodResolver(registerSchema), defaultValues: { name: "", mobile: "", email: "", password: "", confirm: "" } })
  const onSubmit = async ({ confirm, ...v }) => {
    try {
      await register(v)
      toast.success("Account created. Verify your mobile number to continue.")
      navigate(`/verify-otp?next=${encodeURIComponent(params.get("next") || "/")}`)
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  return (
    <AuthCard
      title="Create your account"
      description="Register to order, track and save your wishlist"
      footer={<span>Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Login</Link></span>}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {form.formState.errors.root && <Alert variant="destructive"><AlertDescription>{form.formState.errors.root.message}</AlertDescription></Alert>}
          <Field form={form} name="name" label="Full name" autoComplete="name" />
          <Field form={form} name="mobile" label="Mobile number" inputMode="numeric" maxLength={10} autoComplete="tel-national" />
          <Field form={form} name="email" label="Email" type="email" autoComplete="email" />
          <Field form={form} name="password" label="Password" type="password" autoComplete="new-password" />
          <Field form={form} name="confirm" label="Confirm password" type="password" autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">
            By creating an account you agree to our <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy policy</Link>.
          </p>
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Create account
          </Button>
        </form>
      </Form>
    </AuthCard>
  )
}

/** UM-02: verify mobile by OTP; email verified by link. */
export function VerifyOtp() {
  useDocumentTitle("Verify mobile")
  const { user, ready, setUser } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const form = useForm({ resolver: zodResolver(z.object({ code: otpSchema })), defaultValues: { code: "" } })
  const [cooldown, setCooldown] = useState(30)
  const [verifyOtp] = useVerifyOtpMutation()
  const [sendOtp] = useSendOtpMutation()

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  if (!ready) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  const next = params.get("next") || "/"
  if (user.mobile_verified) {
    return (
      <AuthCard title="Mobile verified" description={user.email_verified ? "Your account is fully verified." : "One more step"}>
        <div className="space-y-4 text-center">
          {!user.email_verified && <EmailPending />}
          <Button className="w-full" onClick={() => navigate(next)}>Continue</Button>
        </div>
      </AuthCard>
    )
  }

  const onSubmit = async (v) => {
    try {
      const data = await verifyOtp(v).unwrap()
      setUser(data.user)
      toast.success("Mobile number verified")
    } catch (e) {
      form.setError("code", { message: errorMessage(e) })
    }
  }
  const resend = async () => {
    try {
      await sendOtp({ mobile: user.mobile, purpose: "verify_mobile" }).unwrap()
      toast.success("OTP sent")
      setCooldown(30)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <AuthCard title="Verify your mobile" description={`Enter the 6-digit OTP sent to +91 ${user.mobile}`}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Field form={form} name="code" label="OTP" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>Verify</Button>
          <Button type="button" variant="link" className="w-full" disabled={cooldown > 0} onClick={resend}>
            {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => navigate(next)}>Skip for now</Button>
        </form>
      </Form>
    </AuthCard>
  )
}

export function EmailPending() {
  const { user } = useAuth()
  const [sent, setSent] = useState(false)
  const [resendEmail] = useResendEmailVerificationMutation()
  if (!user || user.email_verified) return null
  return (
    <Alert>
      <MailCheck className="size-4" />
      <AlertDescription className="space-y-2">
        <p>We sent a verification link to <strong>{user.email}</strong>. Please verify your email before placing your first order.</p>
        <Button
          variant="outline"
          size="sm"
          disabled={sent}
          onClick={async () => {
            try {
              await resendEmail().unwrap()
              setSent(true)
              toast.success("Verification email sent")
            } catch (e) {
              toast.error(errorMessage(e))
            }
          }}
        >
          {sent ? "Email sent" : "Resend email"}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function VerifyEmail() {
  useDocumentTitle("Verify email")
  const [params] = useSearchParams()
  const { user, setUser } = useAuth()
  const [state, setState] = useState("loading")
  const [message, setMessage] = useState("")
  const [verifyEmail] = useVerifyEmailMutation()
  const [fetchMe] = useLazyGetCurrentUserQuery()
  useEffect(() => {
    const token = params.get("token")
    if (!token) {
      setState("error")
      setMessage("This verification link is invalid.")
      return
    }
    verifyEmail(token)
      .unwrap()
      .then(() => setState("ok"))
      .catch((e) => {
        setState("error")
        setMessage(errorMessage(e))
      })
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state === "ok" && user) fetchMe().unwrap().then((data) => setUser(data)).catch(() => {})
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps
  if (state === "loading") return <PageLoader />
  return (
    <AuthCard title={state === "ok" ? "Email verified" : "Verification failed"}>
      <div className="space-y-4 text-center">
        {state === "ok" ? <CheckCircle2 className="mx-auto size-12 text-emerald-600 dark:text-emerald-400" /> : <XCircle className="mx-auto size-12 text-destructive" />}
        <p className="text-sm text-muted-foreground">{state === "ok" ? "Thank you! Your email address is verified." : message}</p>
        <Button asChild className="w-full"><Link to={user ? "/" : "/login"}>{user ? "Continue shopping" : "Login"}</Link></Button>
      </div>
    </AuthCard>
  )
}

export function ForgotPassword() {
  useDocumentTitle("Forgot password")
  const navigate = useNavigate()
  const [channel, setChannel] = useState(null)
  const [mobile, setMobile] = useState("")
  const [forgotPassword] = useForgotPasswordMutation()
  const [resetPassword] = useResetPasswordMutation()
  const form = useForm({ resolver: zodResolver(z.object({ identifier: z.string().trim().min(3, "Enter your email or mobile") })), defaultValues: { identifier: "" } })
  const otpForm = useForm({
    resolver: zodResolver(z.object({ code: otpSchema, new_password: passwordSchema })),
    defaultValues: { code: "", new_password: "" },
  })

  const onSubmit = async ({ identifier }) => {
    try {
      const data = await forgotPassword(identifier).unwrap()
      setChannel(data.channel)
      setMobile(identifier)
    } catch (e) {
      form.setError("identifier", { message: errorMessage(e) })
    }
  }
  const onReset = async (v) => {
    try {
      await resetPassword({ mobile, code: v.code, new_password: v.new_password }).unwrap()
      toast.success("Password changed. Please login.")
      navigate("/login")
    } catch (e) {
      otpForm.setError("code", { message: errorMessage(e) })
    }
  }

  if (channel === "email") {
    return (
      <AuthCard title="Check your email" description="If an account exists for this email, we've sent a reset link. It is valid for 15 minutes and can be used once.">
        <Button asChild className="w-full"><Link to="/login">Back to login</Link></Button>
      </AuthCard>
    )
  }
  if (channel === "sms") {
    return (
      <AuthCard title="Reset password" description={`If ${mobile} is registered, an OTP has been sent to it.`}>
        <Form {...otpForm}>
          <form onSubmit={otpForm.handleSubmit(onReset)} className="space-y-4">
            <Field form={otpForm} name="code" label="OTP" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
            <Field form={otpForm} name="new_password" label="New password" type="password" autoComplete="new-password" />
            <Button type="submit" className="w-full" disabled={otpForm.formState.isSubmitting}>Reset password</Button>
          </form>
        </Form>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Forgot password" description="Enter your email for a reset link, or your mobile number for an OTP." footer={<Link to="/login" className="text-primary hover:underline">Back to login</Link>}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Field form={form} name="identifier" label="Email or mobile number" />
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>Continue</Button>
        </form>
      </Form>
    </AuthCard>
  )
}

export function ResetPassword() {
  useDocumentTitle("Reset password")
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [resetPassword] = useResetPasswordMutation()
  const form = useForm({
    resolver: zodResolver(z.object({ new_password: passwordSchema, confirm: z.string() }).refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords do not match" })),
    defaultValues: { new_password: "", confirm: "" },
  })
  const onSubmit = async (v) => {
    try {
      await resetPassword({ token: params.get("token"), new_password: v.new_password }).unwrap()
      toast.success("Password changed. Please login.")
      navigate("/login")
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  return (
    <AuthCard title="Set a new password">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {form.formState.errors.root && <Alert variant="destructive"><AlertDescription>{form.formState.errors.root.message}</AlertDescription></Alert>}
          <Field form={form} name="new_password" label="New password" type="password" autoComplete="new-password" />
          <Field form={form} name="confirm" label="Confirm password" type="password" autoComplete="new-password" />
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>Save password</Button>
        </form>
      </Form>
    </AuthCard>
  )
}
