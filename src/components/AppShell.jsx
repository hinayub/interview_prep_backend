import { useDispatch, useSelector } from 'react-redux'
import { Link, Outlet, useNavigate } from 'react-router-dom'

import { clearWorkspace } from '../lib/draft'
import { loggedOut, selectCandidate } from '../store/authSlice'
import { apiSlice } from '../store/apiSlice'
import { CortexMark } from './icons'

export default function AppShell() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const candidate = useSelector(selectCandidate)

  function signOut() {
    dispatch(loggedOut())
    // Cached server data belongs to the previous session; drop it so the next
    // person to sign in on this machine cannot read it out of the store. The
    // bench is theirs too — leaving the posting they typed, or the pair they were
    // working against, would show a stranger the job they were applying for and
    // hand the next sign-in a half-finished application instead of a clean one.
    dispatch(apiSlice.util.resetApiState())
    clearWorkspace()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-seam bg-house/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link to="/" className="group flex items-center gap-2.5 rounded-lg" aria-label="Cortex home">
            <CortexMark className="size-6 text-sodium transition-transform duration-500 group-hover:rotate-[8deg]" />
            <span className="font-display text-base font-extrabold tracking-[-0.02em]">Cortex</span>
          </Link>

          <div className="flex items-center gap-4">
            {candidate?.username && (
              <span className="hidden font-mono text-eyebrow text-shade sm:inline">
                {candidate.username}
              </span>
            )}
            <button type="button" onClick={signOut} className="btn-quiet px-3 py-1.5 text-sm">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
