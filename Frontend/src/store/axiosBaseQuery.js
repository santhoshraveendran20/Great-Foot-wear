import { retry } from "@reduxjs/toolkit/query/react"

import { api } from "@/lib/api"

/**
 * RTK Query base query that sends every request through the shared axios instance
 * (src/lib/api.js), so the bearer token and the refresh-on-401 interceptor apply.
 *
 * Endpoint `query` returns a url string or { url, method, data, params, headers, responseType }.
 * Errors come back as { status, data, message } — `status` is the HTTP status or "FETCH_ERROR";
 * errorMessage() in src/lib/api.js reads them.
 */
export function axiosBaseQuery() {
  return async (args, { signal }) => {
    const { url, method = "get", data, params, headers, responseType } = typeof args === "string" ? { url: args } : args
    try {
      const result = await api.request({ url, method, data, params, headers, responseType, signal })
      return { data: result.data }
    } catch (err) {
      return { error: { status: err.response?.status ?? "FETCH_ERROR", data: err.response?.data, message: err.message } }
    }
  }
}

// Queries retry twice on network errors and 5xx; 4xx and mutations never retry.
export const baseQuery = retry(axiosBaseQuery(), {
  retryCondition: (error, _args, { attempt, baseQueryApi }) =>
    baseQueryApi.type === "query" && attempt <= 2 && !(typeof error.status === "number" && error.status < 500),
})
