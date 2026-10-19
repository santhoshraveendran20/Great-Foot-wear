import { baseApi } from "@/store/baseApi"

/** Checkout quote, order placement and payment retry. */
export const checkoutApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // count / couponCode are part of the cache key only, so the quote refreshes when the cart changes
    getCheckoutQuote: build.query({
      query: ({ fulfilment, addressId, payment }) => ({
        url: "/cart/quote",
        method: "post",
        data: { fulfilment, address_id: fulfilment === "delivery" ? addressId : null, payment_method: payment },
      }),
    }),
    placeCheckoutOrder: build.mutation({
      query: ({ fulfilment, addressId, payment }) => ({
        url: "/orders/checkout",
        method: "post",
        data: { fulfilment, address_id: fulfilment === "delivery" ? addressId : null, payment_method: payment },
      }),
      invalidatesTags: ["Cart", "MyOrders"],
    }),
    // PY-06: new gateway order for a pending order
    createOrderPayment: build.mutation({
      query: (orderId) => ({ url: "/payments/create-order", method: "post", data: { order_id: Number(orderId) } }),
    }),
  }),
})

export const { useGetCheckoutQuoteQuery, usePlaceCheckoutOrderMutation, useCreateOrderPaymentMutation } = checkoutApi
