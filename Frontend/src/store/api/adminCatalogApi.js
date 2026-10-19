import { baseApi } from "@/store/baseApi"

// write a product response into the getAdminProduct cache (the form page reads it from there)
async function upsertProduct(_arg, { dispatch, queryFulfilled }) {
  try {
    const { data } = await queryFulfilled
    dispatch(baseApi.util.upsertQueryData("getAdminProduct", String(data.id), data))
  } catch {
    // the caller handles the error
  }
}

/** Admin dashboard, products, inventory, categories / brands and image uploads. */
export const adminCatalogApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // dashboard
    // records behind a dashboard card: { metric: customers|orders|sales|pending|returns, period: today|week|month }
    getAdminDashboardDetails: build.query({
      query: (params) => ({ url: "/admin/dashboard/details", params }),
      providesTags: ["AdminDashboard"],
    }),
    getAdminDashboard: build.query({
      query: () => "/admin/dashboard",
      providesTags: ["AdminDashboard"],
    }),

    // products
    getAdminProducts: build.query({
      query: (params) => ({ url: "/admin/products", params }),
      providesTags: ["AdminProducts"],
    }),
    getAdminProduct: build.query({
      query: (id) => `/admin/products/${id}`,
      providesTags: (_r, _e, id) => [{ type: "AdminProduct", id: String(id) }],
    }),
    // create: { files, ...body } is sent as one multipart request (product JSON + its images, at least one);
    // update: { id, ...body } as JSON (images are managed separately once the product exists)
    saveAdminProduct: build.mutation({
      query: ({ id, files, ...body }) => {
        if (id) return { url: `/admin/products/${id}`, method: "put", data: body }
        const fd = new FormData()
        fd.append("data", JSON.stringify(body))
        ;(files || []).forEach((f) => fd.append("files", f))
        return { url: "/admin/products", method: "post", data: fd }
      },
      onQueryStarted: upsertProduct,
      invalidatesTags: ["AdminProducts", "Inventory", "AdminDashboard"],
    }),
    deleteAdminProduct: build.mutation({
      query: (id) => ({ url: `/admin/products/${id}`, method: "delete" }),
      invalidatesTags: ["AdminProducts", "Inventory", "AdminDashboard"],
    }),
    importAdminProducts: build.mutation({
      query: (fd) => ({ url: "/admin/products-import", method: "post", data: fd }),
      // the import sets stock and edits products, so cached product forms are dropped too
      invalidatesTags: ["AdminProducts", "AdminProduct", "Inventory", "AdminDashboard"],
    }),
    uploadAdminProductImages: build.mutation({
      query: ({ id, fd }) => ({ url: `/admin/products/${id}/images`, method: "post", data: fd }),
      onQueryStarted: upsertProduct,
      invalidatesTags: ["AdminProducts"],
    }),
    reorderAdminProductImages: build.mutation({
      query: ({ id, ids }) => ({ url: `/admin/products/${id}/images/order`, method: "put", data: { ids } }),
      onQueryStarted: upsertProduct,
      invalidatesTags: ["AdminProducts"],
    }),
    deleteAdminProductImage: build.mutation({
      query: ({ id, imageId }) => ({ url: `/admin/products/${id}/images/${imageId}`, method: "delete" }),
      onQueryStarted: upsertProduct,
      invalidatesTags: ["AdminProducts"],
    }),

    // inventory
    getAdminInventory: build.query({
      query: (params) => ({ url: "/admin/inventory", params }),
      providesTags: ["Inventory"],
    }),
    getAdminStockHistory: build.query({
      query: (params) => ({ url: "/admin/inventory/movements", params }),
      providesTags: ["StockHistory"],
    }),
    adjustAdminStock: build.mutation({
      query: (body) => ({ url: "/admin/inventory/adjust", method: "post", data: body }),
      // the product form shows each variant's stock and threshold
      invalidatesTags: ["Inventory", "StockHistory", "AdminProducts", "AdminProduct", "AdminDashboard"],
    }),
    updateAdminStockThreshold: build.mutation({
      query: ({ variantId, threshold }) => ({ url: `/admin/inventory/${variantId}/threshold`, method: "put", data: { low_stock_threshold: threshold } }),
      invalidatesTags: ["Inventory", "AdminProduct", "AdminDashboard"],
    }),

    // categories / brands (lists come from getAdminTaxonomy in commonApi)
    saveAdminTaxonomy: build.mutation({
      query: ({ kind, id, body }) =>
        id ? { url: `/admin/${kind}/${id}`, method: "put", data: body } : { url: `/admin/${kind}`, method: "post", data: body },
      invalidatesTags: (_r, _e, { kind }) => [{ type: "Taxonomy", id: kind }, "Home"],
    }),
    deleteAdminTaxonomy: build.mutation({
      query: ({ kind, id }) => ({ url: `/admin/${kind}/${id}`, method: "delete" }),
      invalidatesTags: (_r, _e, { kind }) => [{ type: "Taxonomy", id: kind }, "Home"],
    }),
    reorderAdminCategories: build.mutation({
      query: (ids) => ({ url: "/admin/categories/reorder", method: "post", data: { ids } }),
      invalidatesTags: [{ type: "Taxonomy", id: "categories" }, "Home"],
    }),

    // single image upload (category images, brand logos, banners, ...)
    uploadAdminImage: build.mutation({
      query: ({ folder, fd }) => ({ url: `/admin/upload?folder=${folder}`, method: "post", data: fd }),
    }),
  }),
})

export const {
  useGetAdminDashboardQuery,
  useGetAdminDashboardDetailsQuery,
  useGetAdminProductsQuery,
  useGetAdminProductQuery,
  useSaveAdminProductMutation,
  useDeleteAdminProductMutation,
  useImportAdminProductsMutation,
  useUploadAdminProductImagesMutation,
  useReorderAdminProductImagesMutation,
  useDeleteAdminProductImageMutation,
  useGetAdminInventoryQuery,
  useGetAdminStockHistoryQuery,
  useAdjustAdminStockMutation,
  useUpdateAdminStockThresholdMutation,
  useSaveAdminTaxonomyMutation,
  useDeleteAdminTaxonomyMutation,
  useReorderAdminCategoriesMutation,
  useUploadAdminImageMutation,
} = adminCatalogApi
