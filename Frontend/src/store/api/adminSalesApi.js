import { baseApi } from "@/store/baseApi"

/** Admin sales: orders, returns, payments & refunds, customers, reviews. */
export const adminSalesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // orders
    getAdminOrders: build.query({
      query: (params) => ({ url: "/admin/orders", params }),
      providesTags: ["AdminOrders"],
    }),
    getAdminOrder: build.query({
      query: (id) => `/admin/orders/${id}`,
      providesTags: (_r, _e, id) => [{ type: "AdminOrder", id: String(id) }],
    }),
    // resolves to the updated order; the page writes it into the getAdminOrder cache
    updateAdminOrderStatus: build.mutation({
      query: ({ id, ...body }) => ({ url: `/admin/orders/${id}/status`, method: "post", data: body }),
      invalidatesTags: ["AdminOrders"],
    }),
    // resolves to the updated order; the page writes it into the getAdminOrder cache
    saveAdminOrderShipment: build.mutation({
      query: ({ id, ...body }) => ({ url: `/admin/orders/${id}/shipment`, method: "put", data: body }),
    }),
    createAdminOrderRefund: build.mutation({
      query: ({ id, ...body }) => ({ url: `/admin/orders/${id}/refunds`, method: "post", data: body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "AdminOrder", id: String(id) }, "Refunds"],
    }),

    // returns & exchanges
    getAdminReturns: build.query({
      query: (status) => ({ url: "/admin/returns", params: { status: status === "all" ? undefined : status } }),
      providesTags: ["Returns"],
    }),
    actOnAdminReturn: build.mutation({
      query: ({ id, ...body }) => ({ url: `/admin/returns/${id}`, method: "post", data: body }),
      invalidatesTags: ["Returns"],
    }),

    // payments & refunds
    getAdminPayments: build.query({
      query: (params) => ({ url: "/admin/payments", params }),
      providesTags: ["Payments"],
    }),
    getAdminRefunds: build.query({
      query: () => "/admin/refunds",
      providesTags: ["Refunds"],
    }),
    actOnAdminRefund: build.mutation({
      query: ({ id, action }) => ({ url: `/admin/refunds/${id}/${action}`, method: "post" }),
      invalidatesTags: ["Refunds"],
    }),

    // customers
    getAdminCustomers: build.query({
      query: (params) => ({ url: "/admin/customers", params }),
      providesTags: ["Customers"],
    }),
    getAdminCustomer: build.query({
      query: (id) => `/admin/customers/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Customer", id: String(id) }],
    }),
    setAdminCustomerActive: build.mutation({
      query: ({ id, is_active }) => ({ url: `/admin/customers/${id}/block`, method: "post", data: { is_active } }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Customer", id: String(id) }, "Customers"],
    }),

    // reviews
    getAdminReviews: build.query({
      query: (status) => ({ url: "/admin/reviews", params: { status: status === "all" ? undefined : status } }),
      providesTags: ["AdminReviews"],
    }),
    moderateAdminReview: build.mutation({
      query: ({ id, is_approved }) => ({ url: `/admin/reviews/${id}`, method: "post", data: { is_approved } }),
      invalidatesTags: ["AdminReviews", "Reviews"],
    }),
  }),
})

export const {
  useGetAdminOrdersQuery,
  useGetAdminOrderQuery,
  useUpdateAdminOrderStatusMutation,
  useSaveAdminOrderShipmentMutation,
  useCreateAdminOrderRefundMutation,
  useGetAdminReturnsQuery,
  useActOnAdminReturnMutation,
  useGetAdminPaymentsQuery,
  useGetAdminRefundsQuery,
  useActOnAdminRefundMutation,
  useGetAdminCustomersQuery,
  useGetAdminCustomerQuery,
  useSetAdminCustomerActiveMutation,
  useGetAdminReviewsQuery,
  useModerateAdminReviewMutation,
} = adminSalesApi
