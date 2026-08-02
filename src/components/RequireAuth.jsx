import { useRef } from 'react'
import { useSelector } from 'react-redux'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { selectIsAuthenticated } from '../store/authSlice'

const EXPIRED =
  'Your session ended, so nothing was saved. Sign in again — the role you typed is still here.'

export default function RequireAuth() {
  const isAuthenticated = useSelector(selectIsAuthenticated)
  const location = useLocation()
  // Losing a session that was working means it expired mid-use, which deserves an
  // explanation. Arriving with no session at all just needs the sign-in form.
  const hadSession = useRef(false)

  if (isAuthenticated) {
    hadSession.current = true
    return <Outlet />
  }

  return (
    // Remember where they were headed so login can send them back there.
    <Navigate
      to="/sign-in"
      replace
      state={{ from: location, reason: hadSession.current ? EXPIRED : undefined }}
    />
  )
}
