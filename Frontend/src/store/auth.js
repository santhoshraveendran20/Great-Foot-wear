import { useMemo } from "react"
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit"
import { useDispatch, useSelector } from "react-redux"

import { api, refreshSession, setAccessToken } from "@/lib/api"
import { baseApi } from "@/store/baseApi"

/**
 * Signed-in user. The access token stays in memory inside src/lib/api.js and the refresh token is an
 * httpOnly cookie (UM-07); only the user object is kept in Redux.
 */
const rejectShape = (e) => ({ status: e.response?.status ?? "FETCH_ERROR", data: e.response?.data, message: e.message })

// restore the session from the refresh cookie when the app starts
export const initSession = createAsyncThunk("auth/initSession", async () => (await refreshSession()).user)

function sessionThunk(type, url) {
  return createAsyncThunk(type, async (body, { rejectWithValue }) => {
    try {
      const { data } = await api.post(url, body)
      setAccessToken(data.access_token)
      return data.user
    } catch (e) {
      return rejectWithValue(rejectShape(e))
    }
  })
}

export const login = sessionThunk("auth/login", "/auth/login")
export const otpLogin = sessionThunk("auth/otpLogin", "/auth/otp-login")
export const register = sessionThunk("auth/register", "/auth/register")

export const logout = createAsyncThunk("auth/logout", async (_, { dispatch }) => {
  try {
    await api.post("/auth/logout")
  } finally {
    setAccessToken(null)
    dispatch(baseApi.util.resetApiState()) // drop every cached response of the previous user
  }
})

const authSlice = createSlice({
  name: "auth",
  initialState: { user: null, ready: false },
  reducers: {
    setUser(state, action) {
      state.user = action.payload
    },
    sessionExpired(state) {
      state.user = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initSession.fulfilled, (state, action) => {
        state.user = action.payload
        state.ready = true
      })
      .addCase(initSession.rejected, (state) => {
        state.user = null
        state.ready = true
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null
      })
      .addCase(logout.rejected, (state) => {
        state.user = null
      })
    for (const thunk of [login, otpLogin, register]) {
      builder.addCase(thunk.fulfilled, (state, action) => {
        state.user = action.payload
      })
    }
  },
})

export const { setUser, sessionExpired } = authSlice.actions
export default authSlice.reducer

export const selectUser = (state) => state.auth.user

/**
 * { user, ready, isStaff, setUser, login, otpLogin, register, logout }.
 * login / otpLogin / register resolve to the user and reject with { status, data } (use errorMessage()).
 */
export function useAuth() {
  const dispatch = useDispatch()
  const user = useSelector(selectUser)
  const ready = useSelector((state) => state.auth.ready)
  return useMemo(
    () => ({
      user,
      ready,
      isStaff: Boolean(user && user.role !== "customer"),
      setUser: (u) => dispatch(setUser(u)),
      login: (identifier, password) => dispatch(login({ identifier, password })).unwrap(),
      otpLogin: (mobile, code) => dispatch(otpLogin({ mobile, code })).unwrap(),
      register: (values) => dispatch(register(values)).unwrap(),
      logout: () => dispatch(logout()).unwrap().catch(() => {}),
    }),
    [user, ready, dispatch]
  )
}
