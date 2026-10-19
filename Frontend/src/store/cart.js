import { useMemo } from "react"
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit"
import { useDispatch, useSelector } from "react-redux"

import { baseApi } from "@/store/baseApi"
import { cartApi, setCartData, useGetCartQuery, useGetGuestCartQuery } from "@/store/api/cartApi"

/**
 * Guest cart is stored locally (section 3: Cart – Guest "local").
 * Customer cart is saved on the server; the guest cart merges into it on login (UM-18).
 */
export const GUEST_CART_KEY = "gfw_guest_cart"
const MAX_QTY = 5
const EMPTY_CART = { items: [], summary: null, count: 0 }

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(GUEST_CART_KEY) || "[]")
  } catch {
    return []
  }
}

// UM-18: runs once per signed-in customer (see the listener in src/store/index.js)
export const mergeGuestCart = createAsyncThunk(
  "cart/mergeGuestCart",
  async (_, { getState, dispatch }) => {
    try {
      const data = await dispatch(cartApi.endpoints.mergeCart.initiate(getState().cart.guestItems)).unwrap()
      dispatch(setCartData(data))
      dispatch(clearGuestItems())
    } catch {
      dispatch(baseApi.util.invalidateTags(["Cart"]))
    }
  },
  { condition: (_, { getState }) => getState().cart.guestItems.length > 0 }
)

const cartSlice = createSlice({
  name: "cart",
  initialState: () => ({ guestItems: readLocal(), merging: false }),
  reducers: {
    addGuestItem(state, { payload: { variantId, qty } }) {
      const found = state.guestItems.find((i) => i.variant_id === variantId)
      if (found) found.qty = Math.min(MAX_QTY, found.qty + qty)
      else state.guestItems.push({ variant_id: variantId, qty: Math.min(MAX_QTY, qty) })
    },
    setGuestQty(state, { payload: { variantId, qty } }) {
      const found = state.guestItems.find((i) => i.variant_id === variantId)
      if (found) found.qty = qty
    },
    removeGuestItem(state, { payload: variantId }) {
      state.guestItems = state.guestItems.filter((i) => i.variant_id !== variantId)
    },
    clearGuestItems(state) {
      state.guestItems = []
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(mergeGuestCart.pending, (state) => {
        state.merging = true
      })
      .addCase(mergeGuestCart.fulfilled, (state) => {
        state.merging = false
      })
      .addCase(mergeGuestCart.rejected, (state) => {
        state.merging = false
      })
  },
})

export const { addGuestItem, setGuestQty, removeGuestItem, clearGuestItems } = cartSlice.actions
export default cartSlice.reducer

/** Keeps the guest cart in localStorage. */
export function persistGuestCart(store) {
  let last = store.getState().cart.guestItems
  return store.subscribe(() => {
    const items = store.getState().cart.guestItems
    if (items === last) return
    last = items
    try {
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items))
    } catch {
      // storage unavailable (private mode); the cart still works for this visit
    }
  })
}

/**
 * { cart, loading, count, isGuest, add, setGuestQty, removeGuest, setServerCart }.
 * add() resolves to the updated cart for customers and rejects with { status, data } (use errorMessage()).
 */
export function useCart() {
  const dispatch = useDispatch()
  const user = useSelector((state) => state.auth.user)
  const ready = useSelector((state) => state.auth.ready)
  const guestItems = useSelector((state) => state.cart.guestItems)
  const merging = useSelector((state) => state.cart.merging)
  const isCustomer = user?.role === "customer"

  const server = useGetCartQuery(undefined, { skip: !ready || !isCustomer || merging })
  const guest = useGetGuestCartQuery(guestItems, { skip: !ready || Boolean(user) || guestItems.length === 0 })

  const cart = isCustomer ? server.data : guestItems.length ? guest.data : EMPTY_CART
  const count = isCustomer ? server.data?.count ?? 0 : guestItems.reduce((s, i) => s + i.qty, 0)
  const loading = isCustomer ? merging || server.isLoading : guest.isLoading

  return useMemo(
    () => ({
      cart,
      loading,
      count,
      isGuest: !isCustomer,
      add: async (variantId, qty = 1) => {
        if (isCustomer) return dispatch(cartApi.endpoints.addCartItem.initiate({ variantId, qty })).unwrap()
        dispatch(addGuestItem({ variantId, qty }))
      },
      setGuestQty: (variantId, qty) => dispatch(setGuestQty({ variantId, qty })),
      removeGuest: (variantId) => dispatch(removeGuestItem(variantId)),
      setServerCart: (data) => dispatch(setCartData(data)),
    }),
    [cart, loading, count, isCustomer, dispatch]
  )
}
