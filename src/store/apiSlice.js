import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'

import { accessTokenRefreshed, loggedOut } from './authSlice'

/**
 * One createApi for the whole app. Resource files under store/api/ extend it with
 * injectEndpoints rather than creating their own slices, because cache tags only
 * work inside a single slice — and this app depends on cross-resource
 * invalidation (answering a question invalidates Questions; starting an interview
 * invalidates History).
 *
 * No component may call fetch or axios directly. Polling, caching and
 * invalidation all live here.
 */
const rawBaseQuery = fetchBaseQuery({
  // 127.0.0.1 rather than localhost: see the note in .env.example — localhost also
  // resolves to ::1, which runserver does not listen on.
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api',
  prepareHeaders: (headers, { getState }) => {
    const { token } = getState().auth
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return headers
  },
})

/**
 * Access tokens expire long before refresh tokens do. Without this, a 12-hour-old
 * tab would start 401ing on every request and look broken; here it silently
 * re-ups once and retries, and only logs out if the refresh itself is dead.
 */
const baseQueryWithReauth = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions)

  if (result.error?.status !== 401) return result

  const refresh = api.getState().auth.refresh
  if (!refresh) {
    api.dispatch(loggedOut())
    return result
  }

  const refreshResult = await rawBaseQuery(
    { url: 'auth/refresh/', method: 'POST', body: { refresh } },
    api,
    extraOptions
  )

  if (!refreshResult.data?.access) {
    api.dispatch(loggedOut())
    return result
  }

  api.dispatch(accessTokenRefreshed(refreshResult.data))
  result = await rawBaseQuery(args, api, extraOptions)
  return result
}

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Candidate', 'Resume', 'JobDescription', 'MatchAnalysis', 'Questions', 'Report', 'History'],
  endpoints: () => ({}),
})
