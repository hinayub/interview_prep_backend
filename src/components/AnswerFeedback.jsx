import CueLamp from './CueLamp'
import { CheckIcon, LightbulbIcon } from './icons'
import { bandForAnswer } from '../lib/interview'

/**
 * One answer's score and what to do about it.
 *
 * Rendered in whichever of the three states the evaluation row is in, exactly as
 * MatchResult does for an analysis — the row is the job record, so this is a readout
 * of it rather than a machine with its own states.
 *
 * The model answer is the most useful thing here and it is placed last on purpose:
 * a candidate should read what *they* said was missing before being shown a better
 * version, or they will only remember the better version.
 */

function ScoreLine({ score }) {
  const band = bandForAnswer(score)

  return (
    <div className="flex items-center gap-4">
      <span className="font-display text-3xl font-extrabold tracking-[-0.04em] tabular-nums">
        {score}
        <span className="ml-0.5 font-sans text-sm font-medium text-mist">/100</span>
      </span>

      <div className="min-w-0 flex-1">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-eyebrow uppercase tracking-[0.14em] ${band.chip}`}
        >
          {band.label}
        </span>

        {/* A bare number does not say how far off "good" is. The rail does, and it
            is the same 0-100 scale the match score uses. */}
        <div className="meter mt-2.5">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ${band.bar}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function PointList({ heading, tone, points }) {
  if (!points?.length) return null

  return (
    <div>
      <h5 className="eyebrow mb-2.5">{heading}</h5>
      <ul className="space-y-2">
        {points.map((point, index) => (
          <li
            key={point}
            style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
            className="animate-rise flex gap-2.5 text-sm leading-relaxed text-ink-soft"
          >
            {tone === 'good' ? (
              <CheckIcon className="mt-1 size-3.5 shrink-0 text-mint" />
            ) : (
              // A hollow marker, not a cross: an improvement is work to do, where a
              // cross would read as a mistake already made.
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-full border border-line-strong"
              />
            )}
            {point}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Scoring() {
  return (
    <div className="border-t border-line px-5 py-5" aria-busy="true">
      <p className="flex items-center gap-2">
        <CueLamp state="live" pulse />
        <span className="eyebrow text-azure">Scoring your answer</span>
      </p>

      <div aria-hidden="true" className="mt-4 space-y-2.5">
        <div className="animate-breathe h-3 w-2/3 rounded-full bg-veil" />
        <div className="animate-breathe h-3 w-full rounded-full bg-veil" />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate" role="status">
        Your answer is being read. This one runs on a hosted model, so it is usually a
        few seconds.
      </p>
    </div>
  )
}

function Failed({ evaluation }) {
  return (
    <div className="border-t border-line px-5 py-5">
      <p className="eyebrow mb-2 text-flag">Not scored</p>
      {/* The agent's own message: "no API key configured" and "Gemini declined to
          answer" need different responses from the person reading it. */}
      <p role="alert" className="text-sm leading-relaxed text-ink-soft">
        {evaluation.error_message || 'This answer could not be scored.'}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-mist">
        Your answer is saved either way, and the rest of the interview is unaffected.
      </p>
    </div>
  )
}

function Complete({ evaluation }) {
  const hasPoints = Boolean(evaluation.strengths?.length || evaluation.improvements?.length)

  return (
    <div className="animate-rise border-t border-line">
      <div className="px-5 py-5">
        <ScoreLine score={evaluation.score ?? 0} />

        {evaluation.verdict && (
          <p className="mt-5 leading-relaxed text-ink-soft">{evaluation.verdict}</p>
        )}
      </div>

      {hasPoints && (
        <div className="grid gap-7 border-t border-line px-5 py-5 sm:grid-cols-2 sm:gap-8">
          <PointList heading="What worked" tone="good" points={evaluation.strengths} />
          <PointList heading="What to change" tone="work" points={evaluation.improvements} />
        </div>
      )}

      {evaluation.model_answer && (
        <div className="border-t border-line bg-veil/40 px-5 py-5">
          <h5 className="eyebrow mb-2.5 flex items-center gap-1.5">
            <LightbulbIcon className="size-3.5 text-mist" />
            How a strong answer sounds
          </h5>
          <p className="leading-relaxed text-ink-soft">{evaluation.model_answer}</p>
        </div>
      )}
    </div>
  )
}

export default function AnswerFeedback({ evaluation }) {
  if (!evaluation) return null

  if (evaluation.status === 'failed') return <Failed evaluation={evaluation} />
  if (evaluation.status === 'complete') return <Complete evaluation={evaluation} />
  return <Scoring />
}
