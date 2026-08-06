import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'

import { selectIsAuthenticated } from '../store/authSlice'
import { CortexMark } from './icons'

/**
 * The public header. It sits flush over the hero wash and only grows a hairline
 * and a blur once you have scrolled past the fold, so the top of the page stays
 * as open as it looks in the design.
 */
export default function SiteHeader() {
  const isAuthenticated = useSelector(selectIsAuthenticated)
  const [lifted, setLifted] = useState(false)

  useEffect(() => {
    function onScroll() {
      setLifted(window.scrollY > 12)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={[
        'sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300',
        lifted
          ? 'border-b border-seam bg-house/92 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent',
      ].join(' ')}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link
          to="/"
          className="group flex items-center gap-2.5 rounded-lg text-lit"
          aria-label="Cortex home"
        >
          <CortexMark className="size-6 text-sodium transition-transform duration-500 group-hover:rotate-[8deg]" />
          <span className="font-display text-lg font-extrabold tracking-[-0.02em]">Cortex</span>
        </Link>

        {isAuthenticated ? (
          <Link to="/app" className="btn-lamp px-4 py-2 text-sm">
            Open Cortex
            <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              to="/sign-in"
              className="rounded-lg px-3 py-2 text-sm font-medium text-lit-soft transition-colors hover:text-lit"
            >
              Sign in
            </Link>
            <Link to="/create-account" className="btn-lamp px-4 py-2 text-sm">
              Get started
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
