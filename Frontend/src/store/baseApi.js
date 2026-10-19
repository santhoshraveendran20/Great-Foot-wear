import { createApi } from "@reduxjs/toolkit/query/react"

import { baseQuery } from "@/store/axiosBaseQuery"

/**
 * The single RTK Query API slice. Feature files in src/store/api/ add their endpoints with
 * baseApi.injectEndpoints(), so every page shares one cache and one set of tags.
 */
export const baseApi = createApi({
  reducerPath: "api",
  baseQuery,
  // refetch when a component mounts and the cached data is older than 30 s
  refetchOnMountOrArgChange: 30,
  tagTypes: [
    // storefront
    "StoreSettings", "Home", "Page", "Product", "Products", "Reviews", "CanReview",
    "Wishlist", "WishlistIds", "Cart", "Addresses", "Me", "MyOrders", "Order", "ExchangeOptions",
    // admin
    "AdminDashboard", "Taxonomy", "AdminProducts", "AdminProduct", "Inventory", "StockHistory",
    "AdminOrders", "AdminOrder", "Returns", "Payments", "Refunds", "Customers", "Customer", "AdminReviews",
    "Coupons", "Banners", "Pages", "Report", "Staff", "AuditLog", "AdminSettings", "Settlements", "StockAlerts",
  ],
  endpoints: () => ({}),
})
