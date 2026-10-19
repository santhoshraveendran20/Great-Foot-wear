import { baseApi } from "@/store/baseApi"

/** Endpoints used by more than one area of the app. */
export const commonApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // storefront content
    getStoreSettings: build.query({
      query: () => "/content/settings",
      providesTags: ["StoreSettings"],
      keepUnusedDataFor: 300,
    }),
    getHome: build.query({
      query: () => "/catalog/home",
      providesTags: ["Home"],
    }),
    // every active category incl. sub-categories (header menu); category edits invalidate "Home"
    getCategories: build.query({
      query: () => "/catalog/categories",
      providesTags: ["Home"],
    }),
    checkPincode: build.query({
      query: ({ pincode, orderValue }) => ({
        url: `/catalog/pincode/${pincode}`,
        params: orderValue != null ? { order_value: orderValue } : undefined,
      }),
    }),

    // wishlist
    getWishlistIds: build.query({
      query: () => "/wishlist/ids",
      providesTags: ["WishlistIds"],
    }),
    addToWishlist: build.mutation({
      query: (productId) => ({ url: "/wishlist", method: "post", data: { product_id: productId } }),
      invalidatesTags: ["WishlistIds", "Wishlist"],
    }),
    removeFromWishlist: build.mutation({
      query: (productId) => ({ url: `/wishlist/${productId}`, method: "delete" }),
      invalidatesTags: ["WishlistIds", "Wishlist"],
    }),

    // account
    changePassword: build.mutation({
      query: (body) => ({ url: "/users/me/password", method: "put", data: body }),
    }),
    getAddresses: build.query({
      query: () => "/users/me/addresses",
      providesTags: ["Addresses"],
    }),
    saveAddress: build.mutation({
      query: ({ id, ...body }) =>
        id ? { url: `/users/me/addresses/${id}`, method: "put", data: body } : { url: "/users/me/addresses", method: "post", data: body },
      invalidatesTags: ["Addresses"],
    }),
    deleteAddress: build.mutation({
      query: (id) => ({ url: `/users/me/addresses/${id}`, method: "delete" }),
      invalidatesTags: ["Addresses"],
    }),
    setDefaultAddress: build.mutation({
      query: (id) => ({ url: `/users/me/addresses/${id}/default`, method: "post" }),
      invalidatesTags: ["Addresses"],
    }),

    // orders (order detail + payment result pages)
    getOrder: build.query({
      query: (id) => `/orders/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Order", id: String(id) }],
    }),

    // admin: categories / brands lists ("categories" | "brands")
    getAdminTaxonomy: build.query({
      query: (kind) => `/admin/${kind}`,
      providesTags: (_r, _e, kind) => [{ type: "Taxonomy", id: kind }],
    }),
  }),
})

export const {
  useGetStoreSettingsQuery,
  useGetHomeQuery,
  useGetCategoriesQuery,
  useCheckPincodeQuery,
  useLazyCheckPincodeQuery,
  useGetWishlistIdsQuery,
  useAddToWishlistMutation,
  useRemoveFromWishlistMutation,
  useChangePasswordMutation,
  useGetAddressesQuery,
  useSaveAddressMutation,
  useDeleteAddressMutation,
  useSetDefaultAddressMutation,
  useGetOrderQuery,
  useGetAdminTaxonomyQuery,
} = commonApi
