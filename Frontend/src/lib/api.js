import axios from "axios"

/**
 * Access token lives in memory only; the refresh token is an httpOnly cookie
 * set by the API (UM-07). On a 401 we refresh once and retry the request.
 */
let accessToken = null
let refreshing = null
const listeners = new Set()

export function setAccessToken(token) {
  accessToken = token
}

export function onSessionExpired(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const api = axios.create({ baseURL: "/api", withCredentials: true })

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

export async function refreshSession() {
  if (!refreshing) {
    refreshing = axios
      .post("/api/auth/refresh", null, { withCredentials: true })
      .then((r) => {
        accessToken = r.data.access_token
        return r.data
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    const status = error.response?.status
    const isAuthCall = original?.url?.startsWith("/auth/")
    if (status === 401 && !original._retry && !isAuthCall && accessToken) {
      original._retry = true
      try {
        await refreshSession()
        return api(original)
      } catch {
        accessToken = null
        listeners.forEach((fn) => fn())
      }
    }
    return Promise.reject(error)
  }
)

/** Message for an axios error or an RTK Query / thunk error ({ status, data }). */
export function errorMessage(error, fallback = "Something went wrong. Please try again.") {
  const detail = (error?.response?.data ?? error?.data)?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg
  if (error?.message === "Network Error" || error?.status === "FETCH_ERROR") return "Cannot reach the server. Check your connection."
  return fallback
}

/** Download a file from an authenticated endpoint (invoice, exports). */
export async function downloadFile(url, filename, params) {
  const r = await api.get(url, { responseType: "blob", params })
  const href = URL.createObjectURL(r.data)
  const a = document.createElement("a")
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/** Open a PDF from an authenticated endpoint in a new tab (print invoice / label). */
export async function openPdf(url) {
  const win = window.open("", "_blank")
  const r = await api.get(url, { responseType: "blob" })
  const href = URL.createObjectURL(r.data)
  if (win) win.location.href = href
  else window.location.href = href
}
