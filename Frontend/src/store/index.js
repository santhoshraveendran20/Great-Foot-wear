import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit"
import { setupListeners } from "@reduxjs/toolkit/query"

import { onSessionExpired } from "@/lib/api"
import authReducer, { initSession, sessionExpired } from "@/store/auth"
import { baseApi } from "@/store/baseApi"
import cartReducer, { mergeGuestCart, persistGuestCart } from "@/store/cart"

const listener = createListenerMiddleware()

// UM-18: when a customer signs in (or their session is restored), merge the guest cart into theirs
listener.startListening({
  predicate: (_action, current, previous) =>
    current.auth.user?.role === "customer" && current.auth.user.id !== previous.auth.user?.id,
  effect: (_action, { dispatch }) => {
    dispatch(mergeGuestCart())
  },
})

export const store = configureStore({
  reducer: {
    auth: authReducer,
    cart: cartReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // uploads pass FormData / File objects as mutation arguments
      serializableCheck: { ignoredActionPaths: [/^meta\.arg/, /^meta\.baseQueryMeta/], ignoredPaths: [/^api\./] },
    })
      .prepend(listener.middleware)
      .concat(baseApi.middleware),
})

setupListeners(store.dispatch)
persistGuestCart(store)
onSessionExpired(() => store.dispatch(sessionExpired()))
store.dispatch(initSession())
