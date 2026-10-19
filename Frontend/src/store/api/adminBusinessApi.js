import { baseApi } from "@/store/baseApi"

/** Admin marketing (coupons, banners, pages) and business (reports, staff, audit log, settings). */
export const adminBusinessApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // coupons
    getAdminCoupons: build.query({
      query: () => "/admin/coupons",
      providesTags: ["Coupons"],
    }),
    saveAdminCoupon: build.mutation({
      query: ({ id, ...body }) =>
        id ? { url: `/admin/coupons/${id}`, method: "put", data: body } : { url: "/admin/coupons", method: "post", data: body },
      invalidatesTags: ["Coupons"],
    }),
    deleteAdminCoupon: build.mutation({
      query: (id) => ({ url: `/admin/coupons/${id}`, method: "delete" }),
      invalidatesTags: ["Coupons"],
    }),

    // banners & offer strips
    getAdminBanners: build.query({
      query: () => "/admin/banners",
      providesTags: ["Banners"],
    }),
    saveAdminBanner: build.mutation({
      query: ({ id, ...body }) =>
        id ? { url: `/admin/banners/${id}`, method: "put", data: body } : { url: "/admin/banners", method: "post", data: body },
      invalidatesTags: ["Banners", "Home"],
    }),
    deleteAdminBanner: build.mutation({
      query: (id) => ({ url: `/admin/banners/${id}`, method: "delete" }),
      invalidatesTags: ["Banners", "Home"],
    }),

    // static pages
    getAdminPages: build.query({
      query: () => "/admin/pages",
      providesTags: ["Pages"],
    }),
    updateAdminPage: build.mutation({
      query: ({ slug, ...body }) => ({ url: `/admin/pages/${slug}`, method: "put", data: body }),
      invalidatesTags: (_r, _e, { slug }) => ["Pages", { type: "Page", id: slug }],
    }),

    // reports ({ kind, date_from, date_to })
    getAdminReport: build.query({
      query: ({ kind, ...params }) => ({ url: `/admin/reports/${kind}`, params }),
      providesTags: (_r, _e, { kind }) => [{ type: "Report", id: kind }],
    }),

    // staff users
    getAdminStaff: build.query({
      query: () => "/admin/staff",
      providesTags: ["Staff"],
    }),
    createAdminStaff: build.mutation({
      query: (body) => ({ url: "/admin/staff", method: "post", data: body }),
      invalidatesTags: ["Staff"],
    }),
    updateAdminStaff: build.mutation({
      query: ({ id, ...body }) => ({ url: `/admin/staff/${id}`, method: "put", data: body }),
      invalidatesTags: ["Staff"],
    }),

    // audit log
    getAdminAuditLogs: build.query({
      query: (page) => ({ url: "/admin/audit-logs", params: { page } }),
      providesTags: ["AuditLog"],
    }),

    // settings
    getAdminSettings: build.query({
      query: () => "/admin/settings",
      providesTags: ["AdminSettings"],
    }),
    saveAdminSettings: build.mutation({
      query: ({ group, body }) => ({ url: `/admin/settings/${group}`, method: "put", data: body }),
      invalidatesTags: ["AdminSettings", "StoreSettings"],
    }),
  }),
})

export const {
  useGetAdminCouponsQuery,
  useSaveAdminCouponMutation,
  useDeleteAdminCouponMutation,
  useGetAdminBannersQuery,
  useSaveAdminBannerMutation,
  useDeleteAdminBannerMutation,
  useGetAdminPagesQuery,
  useUpdateAdminPageMutation,
  useGetAdminReportQuery,
  useGetAdminStaffQuery,
  useCreateAdminStaffMutation,
  useUpdateAdminStaffMutation,
  useGetAdminAuditLogsQuery,
  useGetAdminSettingsQuery,
  useSaveAdminSettingsMutation,
} = adminBusinessApi
