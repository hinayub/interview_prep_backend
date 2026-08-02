import CueLamp from './CueLamp'
import MatchScore from './MatchScore'
import { CheckIcon } from './icons'
import { categoryBreakdown, readinessFor } from '../lib/interview'

/**
 * The debrief: what the whole rehearsal added up to.
 *
 * Reuses MatchScore for the headline number rather than inventing a second dial,
 * because it is the same 0-100 scale on the same three bands and a candidate should
 * not have to learn a new way of reading a score on the last screen.
 *
 * The category breakdown is sorted weakest-first — the point of the section is what
 * to work on, so the thing to work on goes at the top.
 */

function Breakdown({ session }) {
  const rows = categoryBreakdown(session)
  if (!rows.length) return null

  return (
    <div>
      <h4 className="eyebrow mb-4">How you scored by area</h4>

      <dl className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.category}>
            <div className="mb-1.5 flex items-baseline justify-between gap-4">
              <dt className="text-sm text-ink-soft">
                {row.label}
                <span className="ml-2 font-mono text-eyebrow text-mist">
                  {row.count} {row.count === 1 ? 'answer' : 'answers'}
                </span>
              </dt>
              <dd className="font-mono text-sm tabular-nums text-ink">{row.score}</dd>
            </div>

            {/* Driven from a state-free inline width and animated by the meter's own
                transition — not [data-reveal], which only becomes visible under a
                scroll reveal that may never fire on a short viewport. */}
            <div className="meter" role="meter" aria-valuenow={row.score} aria-valuemin={0} aria-valuemax={100} aria-label={row.label}>
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-azure to-azure-lift transition-[width] duration-700"
                style={{ width: `${row.score}%`, transitionDelay: `${index * 80}ms` }}
              />
            </div>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Points({ heading, tone, points }) {
  if (!points?.length) return null

  return (
    <div>
      <h4 className="eyebrow mb-3">{heading}</h4>
      <ul className="space-y-2.5">
        {points.map((point, index) => (
          <li
            key={point}
            style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
            className="animate-rise flex gap-2.5 leading-relaxed text-ink-soft"
          >
            {tone === 'good' ? (
              <CheckIcon className="mt-1.5 size-3.5 shrink-0 text-mint" />
            ) : (
              <span
                aria-hidden="true"
                className="mt-2 size-2 shrink-0 rounded-full border border-line-strong"
              />
            )}
            {point}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Writing() {
  return (
    <section className="panel overflow-hidden" aria-busy="true">
      <header className="flex items-center gap-2 border-b border-line bg-veil/60 px-5 py-4">
        <CueLamp state="live" pulse />
        <span className="eyebrow text-azure">Writing your debrief</span>
      </header>

      <div className="px-5 py-6">
        <div className="relative h-2 overflow-hidden rounded-full bg-veil">
          <span
            aria-hidden="true"
            className="animate-sweep absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-azure"
          />
        </div>

        <p className="mt-6 text-sm leading-relaxed text-slate" role="status">
          Your answers are being read together to find the pattern across them. This is
          the last step.
        </p>
      </div>
    </section>
  )
}

function Failed({ report, onRetry }) {
  return (
    <section className="panel overflow-hidden">
      <header className="border-b border-line bg-veil/60 px-5 py-4">
        <span className="eyebrow text-flag">Debrief stopped</span>
      </header>

      <div className="space-y-4 px-5 py-5">
        <p role="alert" className="text-sm leading-relaxed text-ink-soft">
          {report.error_message || 'The debrief could not be written.'}
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

function Complete({ report, session, onRetry }) {
  const readiness = readinessFor(report.readiness)
  const score = report.overall_score ?? 0

  return (
    <section className="animate-rise panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-veil/60 px-5 py-4">
        <h3 className="font-display text-[0.9375rem] font-bold tracking-[-0.015em]">
          Your debrief
        </h3>
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-eyebrow uppercase tracking-[0.14em] ${readiness.chip}`}
        >
          {readiness.label}
        </span>
      </header>

      <p className="sr-only" role="status">
        Debrief ready. {score} out of 100 — {readiness.label}.
      </p>

      {report.headline && (
        <div className="px-5 py-6 sm:px-6">
          <p className="font-display text-xl font-extrabold leading-snug tracking-[-0.03em] text-ink sm:text-2xl">
            {report.headline}
          </p>
        </div>
      )}

      <div className="border-t border-line px-5 py-7 sm:px-6">
        <MatchScore score={score} />
      </div>

      {report.summary && (
        <div className="border-t border-line px-5 py-6 sm:px-6">
          <h4 className="eyebrow mb-2.5">The pattern across your answers</h4>
          <p className="leading-relaxed text-ink-soft">{report.summary}</p>
        </div>
      )}

      <div className="border-t border-line px-5 py-6 sm:px-6">
        <Breakdown session={session} />
      </div>

      <div className="grid gap-7 border-t border-line px-5 py-6 sm:grid-cols-2 sm:gap-8 sm:px-6">
        <Points heading="What you can rely on" tone="good" points={report.strengths} />
        <Points heading="Work on these first" tone="work" points={report.priorities} />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-veil/40 px-5 py-3 sm:px-6">
        <p className="font-mono text-eyebrow text-mist">
          Written over {report.answers_covered}{' '}
          {report.answers_covered === 1 ? 'answer' : 'answers'}
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-quiet text-sm">
            Rewrite it
          </button>
        )}
      </footer>
    </section>
  )
}

export default function ReportCard({ report, session, onRetry }) {
  if (!report) return null

  if (report.status === 'failed') return <Failed report={report} onRetry={onRetry} />
  if (report.status === 'complete') {
    return <Complete report={report} session={session} onRetry={onRetry} />
  }
  return <Writing />
}
