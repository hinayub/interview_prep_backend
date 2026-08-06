import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import MatchResult from './MatchResult'
import { ArrowIcon, ChartIcon, ChevronIcon } from './icons'
import { sessionSummary, whenLabel } from '../lib/history'
import { interviewLink, matchLink } from '../lib/links'

/**
 * What was run against one saved resume-and-posting pair.
 *
 * Two controls, because a pair has exactly two kinds of run attached to it. The
 * match is a single result, so its button shows it in place — it is a page's worth
 * of reading and there is only ever one worth reading. The interviews are a list
 * that grows every time the candidate sits another one, so they are a dropdown of
 * links: each is its own screenful of questions, answers and scores, which belongs
 * on the interview page rather than crammed in here.
 *
 * Mount this with ``key={entry.key}`` so switching records resets both controls
 * rather than leaving the previous pair's match panel hanging open.
 */
export default function PairRuns({ entry }) {
  const [showMatch, setShowMatch] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const dropdown = useRef(null)

  const { match, sessions, resumeId, roleId } = entry

  // A dropdown that outlives the click that should have closed it reads as broken,
  // and one that cannot be dismissed from the keyboard is a trap.
  useEffect(() => {
    if (!listOpen) return

    const onPointerDown = (event) => {
      if (!dropdown.current?.contains(event.target)) setListOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setListOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [listOpen])

  return (
    <section className="panel p-5">
      <h2 className="font-display text-base font-bold tracking-[-0.01em]">
        What you ran for this pair
      </h2>
      <p className="mt-2 leading-relaxed text-dusk">
        Every run is kept, so the score you got and the answers you gave are all still
        here — and you can run another against the same two documents.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {match ? (
          <button
            type="button"
            onClick={() => setShowMatch((open) => !open)}
            aria-expanded={showMatch}
            aria-controls="pair-match"
            className="btn-plain text-sm"
          >
            <ChartIcon className="size-4 text-sodium" />
            {showMatch ? 'Hide the match result' : 'Show the match result'}
            {match.status === 'complete' && (
              <span className="font-mono text-eyebrow text-shade">{match.match_score} / 100</span>
            )}
          </button>
        ) : (
          <Link to={matchLink({ resumeId, roleId })} className="btn-plain group text-sm">
            Run a match for this pair
            <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}

        {sessions.length > 0 ? (
          <div ref={dropdown} className="relative">
            <button
              type="button"
              onClick={() => setListOpen((open) => !open)}
              aria-expanded={listOpen}
              aria-controls="pair-interviews"
              className="btn-plain text-sm"
            >
              {sessions.length === 1 ? 'Interview' : 'Interviews'}
              <span className="font-mono text-eyebrow text-shade">{sessions.length}</span>
              <ChevronIcon
                className={`size-3.5 text-dusk transition-transform duration-200 ${
                  listOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {listOpen && (
              <ul
                id="pair-interviews"
                className="panel absolute left-0 z-20 mt-2 w-72 max-w-[80vw] space-y-0.5 p-1.5 shadow-lift"
              >
                {sessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      to={interviewLink({ sessionId: session.id })}
                      className="block rounded-lg px-3 py-2 transition-colors hover:bg-flat"
                    >
                      <span className="block font-display text-sm font-semibold tracking-[-0.01em]">
                        Interview {session.number}
                      </span>
                      <span className="mt-0.5 block font-mono text-eyebrow text-shade">
                        {[sessionSummary(session), whenLabel(session.created_at)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <Link to={interviewLink({ resumeId, roleId })} className="btn-plain group text-sm">
            Sit an interview for this pair
            <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      {showMatch && match && (
        <div id="pair-match" className="mt-5 space-y-3">
          {/* The same card the match page renders. A saved score shown in a different
              shape from the one it was first read in would look like a different
              number, and re-running from here is what the link is for. */}
          <MatchResult analysis={match} />

          <Link
            to={matchLink({ analysisId: match.id })}
            className="group inline-flex items-center gap-1.5 px-1 text-sm font-medium text-sodium"
          >
            Open this on the match page
            <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}
    </section>
  )
}
