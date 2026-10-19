import { baseApi } from "@/store/baseApi"

/** Storefront catalogue: listing, product detail, reviews, search suggestions, static pages, wishlist page. */
export const catalogApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // listing / search; arg is the query string built by the page
    getCatalogProducts: build.query({
      query: (qs) => `/catalog/products?${qs}`,
      providesTags: ["Products"],
    }),
    getCatalogProduct: build.query({
      query: (slug) => `/catalog/products/${slug}`,
      providesTags: (_r, _e, slug) => [{ type: "Product", id: slug }],
    }),
    getProductReviews: build.query({
      query: (slug) => `/catalog/products/${slug}/reviews`,
      providesTags: (_r, _e, slug) => [{ type: "Reviews", id: slug }],
    }),
    getProductCanReview: build.query({
      query: (slug) => `/catalog/products/${slug}/can-review`,
      providesTags: (_r, _e, slug) => [{ type: "CanReview", id: slug }],
    }),
    submitProductReview: build.mutation({
      query: ({ slug, ...body }) => ({ url: `/catalog/products/${slug}/reviews`, method: "post", data: body }),
      invalidatesTags: (_r, _e, { slug }) => [{ type: "CanReview", id: slug }],
    }),
    // CT-05 auto-suggest
    getSearchSuggestions: build.query({
      query: (q) => ({ url: "/catalog/search/suggest", params: { q } }),
    }),
    // About, Contact, Shipping, ... (edited in admin)
    getStaticPage: build.query({
      query: (slug) => `/content/pages/${slug}`,
      providesTags: (_r, _e, slug) => [{ type: "Page", id: slug }],
    }),
    getWishlist: build.query({
      query: () => "/wishlist",
      providesTags: ["Wishlist"],
    }),
    // returns the updated cart
    moveWishlistItemToCart: build.mutation({
      query: ({ productId, variantId, qty = 1 }) => ({ url: `/wishlist/${productId}/move-to-cart`, method: "post", data: { variant_id: variantId, qty } }),
      invalidatesTags: ["Wishlist", "WishlistIds"],
    }),
  }),
})

export const {
  useGetCatalogProductsQuery,
  useGetCatalogProductQuery,
  useGetProductReviewsQuery,
  useGetProductCanReviewQuery,
  useSubmitProductReviewMutation,
  useGetSearchSuggestionsQuery,
  useGetStaticPageQuery,
  useGetWishlistQuery,
  useMoveWishlistItemToCartMutation,
} = catalogApi
