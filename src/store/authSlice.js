import { createSlice } from '@reduxjs/toolkit'

const STORAGE_KEY = 'greenroom.auth'

/**
 * Auth is the one piece of state that must survive a reload, so it is mirrored to
 * localStorage. Everything else in this app is server state and belongs to RTK
 * Query's cache, not here.
 */
function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    // Corrupt or unavailable storage should log you out, not crash the app.
    return null
  }
}

function persist(state) {
  try {
    if (state.token) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ token: state.token, refresh: state.refresh, candidate: state.candidate })
      )
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Private-browsing mode: session simply will not survive a reload.
  }
}

const persisted = loadPersisted()

const initialState = {
  token: persisted?.token ?? null,
  refresh: persisted?.refresh ?? null,
  candidate: persisted?.candidate ?? null,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    credentialsReceived(state, { payload }) {
      state.token = payload.access
      state.refresh = payload.refresh ?? state.refresh
      if (payload.candidate) state.candidate = payload.candidate
      persist(state)
    },
    accessTokenRefreshed(state, { payload }) {
      state.token = payload.access
      persist(state)
    },
    candidateLoaded(state, { payload }) {
      state.candidate = payload
      persist(state)
    },
    loggedOut(state) {
      state.token = null
      state.refresh = null
      state.candidate = null
      persist(state)
    },
  },
})

export const { credentialsReceived, accessTokenRefreshed, candidateLoaded, loggedOut } =
  authSlice.actions

export const selectIsAuthenticated = (state) => Boolean(state.auth.token)
export const selectCandidate = (state) => state.auth.candidate

export default authSlice.reducer
