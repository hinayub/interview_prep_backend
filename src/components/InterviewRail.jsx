import ModelCredit from './ModelBadge'
import { bandForAnswer } from '../lib/interview'

/**
 * Where the candidate is, and how each answer behind them scored.
 *
 * One marker per question, in order. It doubles as navigation — a finished question
 * can be jumped back to — but the current one is not a link, because there is
 * nowhere else to go from it.
 *
 * Scores are shown on the markers rather than hidden behind them: eight small
 * numbers are the shape of the whole rehearsal at a glance, which is what tells a
 * candidate "the behavioural ones are where I fall down" before any report says so.
 */

function markerStyles(question, isCurrent) {
  // The question being answered is the lit one, so its marker takes the lamp's
  // own treatment: sodium fill, dark label, the light behind the number.
  if (isCurrent) return 'border-sodium bg-sodium text-house shadow-lift'

  const evaluation = question.answer?.evaluation
  if (evaluation?.status === 'complete') {
    const band = bandForAnswer(evaluation.score ?? 0)
    return `${band.chip} border`
  }
  if (question.answer) return 'border-seam-lit bg-riser text-dusk'
  return 'border-seam bg-house text-shade'
}

function markerLabel(question) {
  const evaluation = question.answer?.evaluation
  if (evaluation?.status === 'complete') return evaluation.score
  if (question.answer) return '·'
  return question.order
}

export default function InterviewRail({ questions = [], currentIndex, onJump, session }) {
  if (!questions.length) return null

  return (
    <nav aria-label="Interview progress" className="panel p-5">
      <h2 className="eyebrow mb-4">This interview</h2>

      <ol className="flex flex-wrap gap-2">
        {questions.map((question, index) => {
          const isCurrent = index === currentIndex
          const scored = question.answer?.evaluation?.status === 'complete'
          const reachable = Boolean(question.answer) && !isCurrent

          return (
            <li key={question.id}>
              <button
                type="button"
                onClick={reachable ? () => onJump?.(index) : undefined}
                disabled={!reachable}
                aria-current={isCurrent ? 'step' : undefined}
                title={
                  scored
                    ? `Question ${question.order} — scored ${question.answer.evaluation.score}`
                    : `Question ${question.order}`
                }
                className={[
                  'flex size-9 items-center justify-center rounded-lg font-mono text-sm tabular-nums',
                  'transition-[transform,box-shadow] duration-200',
                  reachable ? 'hover:-translate-y-0.5 hover:shadow-card' : '',
                  !reachable && !isCurrent ? 'cursor-default' : '',
                  markerStyles(question, isCurrent),
                ].join(' ')}
              >
                <span className="sr-only">Question {question.order}</span>
                <span aria-hidden="true">{markerLabel(question)}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <p className="mt-4 font-mono text-eyebrow leading-relaxed text-shade">
        Numbers are the score each answer got. Grey means not answered yet.
      </p>

      {/* The questions have one author and the answers may each have another, so
          the session's credit belongs here rather than repeated on every card. */}
      {session?.model_used && (
        <ModelCredit
          model={session.model_used}
          note={session.race_note}
          prefix="Questions by"
          className="mt-4 border-t border-seam pt-4"
        />
      )}
    </nav>
  )
}
