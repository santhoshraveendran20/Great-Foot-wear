import { baseApi } from "@/store/baseApi"

/** Puts a cart returned by the API into the cached getCart result (every cart endpoint returns the full cart). */
export const setCartData = (data) => baseApi.util.upsertQueryData("getCart", undefined, data)

const updatesCart = {
  async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
    try {
      const { data } = await queryFulfilled
      dispatch(setCartData(data))
    } catch {
      // the caller shows the error
    }
  },
}

export const cartApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // customer cart, saved on the server
    getCart: build.query({
      query: () => "/cart",
      providesTags: ["Cart"],
    }),
    // guest cart lives in the browser; the server only prices it
    getGuestCart: build.query({
      query: (items) => ({ url: "/cart/guest", method: "post", data: { items } }),
    }),
    // UM-18: guest cart merged into the customer cart after login
    mergeCart: build.mutation({
      query: (items) => ({ url: "/cart/merge", method: "post", data: { items } }),
      ...updatesCart,
    }),
    addCartItem: build.mutation({
      query: ({ variantId, qty }) => ({ url: "/cart/items", method: "post", data: { variant_id: variantId, qty } }),
      ...updatesCart,
    }),
    updateCartItem: build.mutation({
      query: ({ id, qty }) => ({ url: `/cart/items/${id}`, method: "patch", data: { qty } }),
      ...updatesCart,
    }),
    removeCartItem: build.mutation({
      query: (id) => ({ url: `/cart/items/${id}`, method: "delete" }),
      ...updatesCart,
    }),
    moveCartItemToWishlist: build.mutation({
      query: (id) => ({ url: `/cart/items/${id}/move-to-wishlist`, method: "post" }),
      ...updatesCart,
      invalidatesTags: ["WishlistIds", "Wishlist"],
    }),
    applyCoupon: build.mutation({
      query: (code) => ({ url: "/cart/apply-coupon", method: "post", data: { code } }),
      ...updatesCart,
    }),
    removeCoupon: build.mutation({
      query: () => ({ url: "/cart/coupon", method: "delete" }),
      ...updatesCart,
    }),
  }),
})

export const {
  useGetCartQuery,
  useGetGuestCartQuery,
  useUpdateCartItemMutation,
  useRemoveCartItemMutation,
  useMoveCartItemToWishlistMutation,
  useApplyCouponMutation,
  useRemoveCouponMutation,
} = cartApi
