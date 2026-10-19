import { baseApi } from "@/store/baseApi"

/** Storefront account: auth helpers (OTP, email verification, password reset), profile and my orders. */
export const accountApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // auth helpers (login / register / otp-login live in src/store/auth.js)
    sendOtp: build.mutation({
      query: (body) => ({ url: "/auth/send-otp", method: "post", data: body }),
    }),
    verifyOtp: build.mutation({
      query: (body) => ({ url: "/auth/verify-otp", method: "post", data: body }),
    }),
    resendEmailVerification: build.mutation({
      query: () => ({ url: "/auth/resend-email-verification", method: "post" }),
    }),
    verifyEmail: build.mutation({
      query: (token) => ({ url: "/auth/verify-email", method: "post", data: { token } }),
    }),
    forgotPassword: build.mutation({
      query: (identifier) => ({ url: "/auth/forgot-password", method: "post", data: { identifier } }),
    }),
    resetPassword: build.mutation({
      query: (body) => ({ url: "/auth/reset-password", method: "post", data: body }),
    }),

    // profile
    getCurrentUser: build.query({
      query: () => "/users/me",
      providesTags: ["Me"],
    }),
    updateMyProfile: build.mutation({
      query: (body) => ({ url: "/users/me", method: "put", data: body }),
    }),
    updateMyPreferences: build.mutation({
      query: (body) => ({ url: "/users/me/preferences", method: "put", data: body }),
    }),
    deleteMyAccount: build.mutation({
      query: (password) => ({ url: "/users/me/delete", method: "post", data: { password } }),
    }),

    // my orders (detail is getOrder in commonApi)
    getMyOrders: build.query({
      query: () => "/orders",
      providesTags: ["MyOrders"],
    }),
    cancelMyOrder: build.mutation({
      query: ({ id, reason }) => ({ url: `/orders/${id}/cancel`, method: "post", data: { reason } }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Order", id: String(id) }, "MyOrders"],
    }),
    getOrderExchangeOptions: build.query({
      query: ({ orderId, itemId }) => `/orders/${orderId}/items/${itemId}/exchange-options`,
      providesTags: ["ExchangeOptions"],
    }),
    requestOrderReturn: build.mutation({
      query: ({ id, data }) => ({ url: `/orders/${id}/return`, method: "post", data }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Order", id: String(id) }, "MyOrders"],
    }),
    saveOrderRefundDetails: build.mutation({
      query: ({ id, ...body }) => ({ url: `/orders/${id}/refund-details`, method: "post", data: body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Order", id: String(id) }, "MyOrders"],
    }),
  }),
})

export const {
  useSendOtpMutation,
  useVerifyOtpMutation,
  useResendEmailVerificationMutation,
  useVerifyEmailMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useLazyGetCurrentUserQuery,
  useUpdateMyProfileMutation,
  useUpdateMyPreferencesMutation,
  useDeleteMyAccountMutation,
  useGetMyOrdersQuery,
  useCancelMyOrderMutation,
  useGetOrderExchangeOptionsQuery,
  useRequestOrderReturnMutation,
  useSaveOrderRefundDetailsMutation,
} = accountApi
