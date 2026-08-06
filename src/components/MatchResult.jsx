import { useEffect, useState } from 'react'

import CueLamp from './CueLamp'
import MatchScore, { bandFor } from './MatchScore'
import ModelCredit from './ModelBadge'
import SkillTally from './SkillTally'

/**
 * One MatchAnalysis row, rendered in whichever of its three states it is in.
 *
 * The row itself is the job record — pending, complete or failed — so this is a
 * readout of it rather than a machine with its own states.
 */

function useElapsedSeconds(since) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!since) return null
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1000))
}

/** How long the agent took, for the footer of a finished run. */
function runSeconds(analysis) {
  if (!analysis.created_at || !analysis.completed_at) return null
  const ms = new Date(analysis.completed_at) - new Date(analysis.created_at)
  return ms > 0 ? Math.round(ms / 1000) : null
}

function Header({ analysis, status, children }) {
  const subtitle = [analysis.company, analysis.resume_filename].filter(Boolean).join(' · ')

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-seam bg-flat/60 px-5 py-4">
      <div className="min-w-0">
        <h3 className="truncate font-display text-[0.9375rem] font-bold tracking-[-0.015em]">
          {analysis.job_title}
        </h3>
        <p className="mt-1 truncate font-mono text-eyebrow text-shade">{subtitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {children}
        {status}
      </div>
    </header>
  )
}

/**
 * The movement between this run and the last one for the same pairing.
 *
 * This is the product's claim — edit your resume, watch the score move — so when
 * there is a previous run to compare against, the change is stated rather than
 * left for the candidate to remember.
 */
function Delta({ from, to }) {
  const change = to - from
  if (change === 0) {
    return (
      <span className="rounded-full border border-seam bg-house px-2.5 py-1 font-mono text-eyebrow text-dusk">
        Same as your last run
      </span>
    )
  }

  const up = change > 0
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-eyebrow ${
        up ? 'border-jade/35 bg-jade/12 text-jade' : 'border-tally/35 bg-tally/12 text-tally'
      }`}
      title={`Your last run scored ${from}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`size-3 ${up ? '' : 'rotate-180'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
      </svg>
      {up ? '+' : '−'}
      {Math.abs(change)} since your last run
    </span>
  )
}

function Working({ analysis }) {
  const seconds = useElapsedSeconds(analysis.created_at)

  return (
    <section className="panel overflow-hidden" aria-busy="true">
      <Header
        analysis={analysis}
        status={
          <p className="flex items-center gap-2">
            <CueLamp state="live" pulse />
            <span className="eyebrow text-sodium">Reading</span>
          </p>
        }
      />

      <div className="px-5 py-6">
        {/* A sketch of the card that is coming, so nothing jumps when it lands. The
            dot running the line is the same motion the landing page uses to thread
            its three steps: something is moving, nothing is claimed finished. */}
        <div className="relative h-2 overflow-hidden rounded-full bg-seam">
          <span
            aria-hidden="true"
            className="animate-sweep absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-sodium"
          />
        </div>

        <div aria-hidden="true" className="mt-7 space-y-2.5">
          <div className="animate-breathe h-3 w-full rounded-full bg-flat" />
          <div className="animate-breathe h-3 w-[92%] rounded-full bg-flat" />
          <div className="animate-breathe h-3 w-[64%] rounded-full bg-flat" />
        </div>

        <p className="mt-7 text-sm leading-relaxed text-dusk" role="status">
          Your resume and the posting have gone to both models at once, and the first
          one to answer is the score you get — usually a few seconds, up to a minute if
          the local model takes it. You can leave this page open.
        </p>

        {seconds !== null && (
          <p className="mt-1.5 font-mono text-eyebrow text-shade">{seconds}s elapsed</p>
        )}
      </div>
    </section>
  )
}

function Failed({ analysis, onRetry }) {
  return (
    <section className="panel overflow-hidden">
      <Header
        analysis={analysis}
        status={<span className="eyebrow text-tally">Stopped</span>}
      />

      <div className="space-y-4 px-5 py-5">
        {/* The agent's own message, not a generic apology: "Ollama is not running"
            and "the model returned unusable JSON" need different responses. */}
        <p role="alert" className="text-sm leading-relaxed text-lit-soft">
          {analysis.error_message || 'The agent stopped before it produced a score.'}
        </p>

        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-plain text-sm">
            Try again
          </button>
        )}
      </div>
    </section>
  )
}

function Complete({ analysis, previous }) {
  const score = analysis.match_score ?? 0
  const took = runSeconds(analysis)
  const analysed = analysis.completed_at
    ? new Date(analysis.completed_at).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null

  return (
    // animate-rise, not a scroll reveal: this card is why the page exists, so it
    // arrives on mount rather than waiting for a scroll that may never come.
    <section className="animate-rise panel overflow-hidden">
      <Header analysis={analysis} status={<span className="eyebrow text-jade">Analysed</span>} />

      {/* Read out once, for anyone who was not watching the page when it landed. */}
      <p className="sr-only" role="status">
        Analysis complete. {score} out of 100 — {bandFor(score).label}.
      </p>

      <div className="px-5 py-7 sm:px-6">
        <MatchScore score={score}>
          {typeof previous?.match_score === 'number' && (
            <Delta from={previous.match_score} to={score} />
          )}
        </MatchScore>
      </div>

      {analysis.reasoning && (
        <div className="border-t border-seam px-5 py-6 sm:px-6">
          <h4 className="eyebrow mb-2.5">Why this score</h4>
          <p className="leading-relaxed text-lit-soft">{analysis.reasoning}</p>
        </div>
      )}

      <div className="border-t border-seam px-5 py-6 sm:px-6">
        <SkillTally matched={analysis.matched_skills} missing={analysis.missing_skills} />
      </div>

      {(analysed || analysis.model_used) && (
        <footer className="space-y-2.5 border-t border-seam bg-flat/40 px-5 py-3 sm:px-6">
          {analysed && (
            <p className="font-mono text-eyebrow text-shade">
              {analysed}
              {took !== null && ` · took ${took}s`}
            </p>
          )}
          {/* "Took 41s" and "Llama 3 answered because Gemini failed" are the same
              story told twice, so they sit together. */}
          <ModelCredit
            model={analysis.model_used}
            note={analysis.race_note}
            prefix="Scored by"
          />
        </footer>
      )}
    </section>
  )
}

export default function MatchResult({ analysis, previous, onRetry }) {
  if (!analysis) return null

  if (analysis.status === 'failed') return <Failed analysis={analysis} onRetry={onRetry} />
  if (analysis.status === 'complete') return <Complete analysis={analysis} previous={previous} />
  return <Working analysis={analysis} />
}
