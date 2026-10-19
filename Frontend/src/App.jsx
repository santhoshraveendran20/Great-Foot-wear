import { lazy, Suspense } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"

import { PageLoader } from "@/components/common"
import { StoreLayout } from "@/components/store/StoreLayout"
import { useAuth } from "@/store/auth"
import Home from "@/pages/store/Home"

// Pages are code-split so the first load stays light (NF-01)
const lazyNamed = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })))
const Listing = lazy(() => import("@/pages/store/Listing"))
const ProductDetail = lazy(() => import("@/pages/store/ProductDetail"))
const Cart = lazy(() => import("@/pages/store/Cart"))
const Checkout = lazy(() => import("@/pages/store/Checkout"))
const Wishlist = lazy(() => import("@/pages/store/Wishlist"))
const Login = lazyNamed(() => import("@/pages/store/Auth"), "Login")
const Register = lazyNamed(() => import("@/pages/store/Auth"), "Register")
const VerifyOtp = lazyNamed(() => import("@/pages/store/Auth"), "VerifyOtp")
const VerifyEmail = lazyNamed(() => import("@/pages/store/Auth"), "VerifyEmail")
const ForgotPassword = lazyNamed(() => import("@/pages/store/Auth"), "ForgotPassword")
const ResetPassword = lazyNamed(() => import("@/pages/store/Auth"), "ResetPassword")
const AccountLayout = lazyNamed(() => import("@/pages/store/Account"), "AccountLayout")
const AccountProfile = lazyNamed(() => import("@/pages/store/Account"), "AccountProfile")
const Addresses = lazyNamed(() => import("@/pages/store/Account"), "Addresses")
const OrderResult = lazyNamed(() => import("@/pages/store/OrderResult"), "OrderResult")
const MyOrders = lazyNamed(() => import("@/pages/store/Orders"), "MyOrders")
const MyOrderDetail = lazyNamed(() => import("@/pages/store/Orders"), "MyOrderDetail")
const StaticPage = lazyNamed(() => import("@/pages/store/StaticPage"), "StaticPage")
const StoreFinder = lazyNamed(() => import("@/pages/store/StoreFinder"), "StoreFinder")
const NotFound = lazyNamed(() => import("@/pages/store/StaticPage"), "NotFound")
const AdminLayout = lazyNamed(() => import("@/components/admin/AdminLayout"), "AdminLayout")
const AdminOnly = lazyNamed(() => import("@/components/admin/AdminLayout"), "AdminOnly")
const AdminLogin = lazyNamed(() => import("@/pages/admin/AdminAuth"), "AdminLogin")
const AdminChangePassword = lazyNamed(() => import("@/pages/admin/AdminAuth"), "AdminChangePassword")
const Dashboard = lazy(() => import("@/pages/admin/Dashboard"))
const Categories = lazyNamed(() => import("@/pages/admin/Taxonomy"), "Categories")
const Brands = lazyNamed(() => import("@/pages/admin/Taxonomy"), "Brands")
const Products = lazy(() => import("@/pages/admin/Products"))
const ProductForm = lazy(() => import("@/pages/admin/ProductForm"))
const Inventory = lazy(() => import("@/pages/admin/Inventory"))
const AdminOrders = lazyNamed(() => import("@/pages/admin/Orders"), "AdminOrders")
const AdminOrderDetail = lazyNamed(() => import("@/pages/admin/Orders"), "AdminOrderDetail")
const AdminReturns = lazyNamed(() => import("@/pages/admin/Sales"), "AdminReturns")
const AdminPayments = lazyNamed(() => import("@/pages/admin/Sales"), "AdminPayments")
const AdminCustomers = lazyNamed(() => import("@/pages/admin/Sales"), "AdminCustomers")
const AdminCustomerDetail = lazyNamed(() => import("@/pages/admin/Sales"), "AdminCustomerDetail")
const AdminReviews = lazyNamed(() => import("@/pages/admin/Sales"), "AdminReviews")
const AdminCoupons = lazyNamed(() => import("@/pages/admin/Marketing"), "AdminCoupons")
const AdminContent = lazyNamed(() => import("@/pages/admin/Marketing"), "AdminContent")
const AdminReports = lazyNamed(() => import("@/pages/admin/Business"), "AdminReports")
const AdminStaff = lazyNamed(() => import("@/pages/admin/Business"), "AdminStaff")
const AdminAuditLog = lazyNamed(() => import("@/pages/admin/Business"), "AdminAuditLog")
const AdminSettings = lazyNamed(() => import("@/pages/admin/Business"), "AdminSettings")

/** Login-protected customer pages (section 3.1). */
function RequireCustomer({ children }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <PageLoader />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (user.role !== "customer") return <Navigate to="/admin" replace />
  return children
}

const superAdmin = (el) => <AdminOnly>{el}</AdminOnly>
const STATIC = ["about", "contact", "shipping", "returns", "privacy", "terms"]

export default function App() {
  return (
    <Suspense fallback={<PageLoader className="min-h-screen" />}>
      <Routes>
        {/* User view */}
        <Route element={<StoreLayout />}>
          <Route index element={<Home />} />
          <Route path="category/:slug" element={<Listing />} />
          <Route path="search" element={<Listing />} />
          <Route path="product/:slug" element={<ProductDetail />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="verify-otp" element={<VerifyOtp />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="cart" element={<Cart />} />
          <Route path="wishlist" element={<RequireCustomer><Wishlist /></RequireCustomer>} />
          <Route path="checkout" element={<RequireCustomer><Checkout /></RequireCustomer>} />
          <Route path="order/:id/success" element={<RequireCustomer><OrderResult outcome="success" /></RequireCustomer>} />
          <Route path="order/:id/failed" element={<RequireCustomer><OrderResult outcome="failed" /></RequireCustomer>} />
          <Route path="account" element={<RequireCustomer><AccountLayout /></RequireCustomer>}>
            <Route index element={<AccountProfile />} />
            <Route path="addresses" element={<Addresses />} />
            <Route path="orders" element={<MyOrders />} />
            <Route path="orders/:id" element={<MyOrderDetail />} />
          </Route>
          <Route path="store-finder" element={<StoreFinder />} />
          {STATIC.map((slug) => <Route key={slug} path={slug} element={<StaticPage slug={slug} />} />)}
          <Route path="*" element={<NotFound />} />
        </Route>

        {/* Admin view */}
        <Route path="admin/login" element={<AdminLogin />} />
        <Route path="admin/change-password" element={<AdminChangePassword />} />
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="categories" element={<Categories />} />
          <Route path="brands" element={<Brands />} />
          <Route path="products" element={<Products />} />
          <Route path="products/new" element={<ProductForm />} />
          <Route path="products/:id" element={<ProductForm />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="orders/:id" element={<AdminOrderDetail />} />
          <Route path="returns" element={<AdminReturns />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route path="customers/:id" element={<AdminCustomerDetail />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="payments" element={superAdmin(<AdminPayments />)} />
          <Route path="coupons" element={superAdmin(<AdminCoupons />)} />
          <Route path="content" element={superAdmin(<AdminContent />)} />
          <Route path="reports" element={superAdmin(<AdminReports />)} />
          <Route path="staff" element={superAdmin(<AdminStaff />)} />
          <Route path="audit-log" element={superAdmin(<AdminAuditLog />)} />
          <Route path="settings" element={superAdmin(<AdminSettings />)} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
