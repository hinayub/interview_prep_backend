import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'

import { apiSlice } from './apiSlice'
import authReducer from './authSlice'

// Endpoint modules must be imported for their injectEndpoints side effect.
import './api/authApi'
import './api/resumesApi'
import './api/jobDescriptionsApi'
import './api/matchApi'

export function makeStore(preloadedState) {
  return configureStore({
    reducer: {
      auth: authReducer,
      [apiSlice.reducerPath]: apiSlice.reducer,
    },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
    preloadedState,
  })
}

export const store = makeStore()

// Refetch on reconnect / tab focus — relevant once Phase 3 introduces polling.
setupListeners(store.dispatch)
