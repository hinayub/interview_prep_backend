import { useEffect, useRef, useState } from 'react'

import AnswerFeedback from './AnswerFeedback'
import Notice from './Notice'
import { AskIcon, ClockIcon } from './icons'
import { CATEGORY_LABELS } from '../lib/interview'

/**
 * One question: the form while it is unanswered, the transcript once it is not.
 *
 * The same component does both so the question text never moves on the screen at
 * the moment of submitting — what changes is that the textarea is replaced by what
 * was typed, with the score arriving underneath it.
 *
 * Two things are withheld until after an answer is committed: the focus label,
 * which would otherwise tell the candidate what the question is testing, and the
 * feedback. That is the whole point of a rehearsal being a rehearsal.
 */

const MIN_CHARS = 40

function CategoryChip({ category }) {
  return (
    <span className="rounded-full border border-seam bg-house px-2.5 py-1 font-mono text-eyebrow uppercase tracking-[0.14em] text-dusk">
      {CATEGORY_LABELS[category] ?? category}
    </span>
  )
}

/** Counts up while the candidate is on this question, for the record afterwards. */
function useStopwatch(running) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!running) return undefined

    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [running])

  return seconds
}

function clock(seconds) {
  if (seconds === null || seconds === undefined) return null
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

function AnswerForm({ question, onSubmit, submitting, error }) {
  const [text, setText] = useState('')
  const seconds = useStopwatch(true)
  const inputId = `answer-${question.id}`

  // Focus the box when the question changes, so answering the next one does not
  // need a click. Keyed on question.id rather than on mount: the card is reused as
  // the interview advances.
  const box = useRef(null)
  useEffect(() => {
    box.current?.focus()
  }, [question.id])

  const short = text.trim().length < MIN_CHARS
  const remaining = MIN_CHARS - text.trim().length

  return (
    <form
      className="border-t border-seam px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!short) onSubmit({ text: text.trim(), secondsTaken: seconds })
      }}
    >
      <div className="mb-2 flex items-end justify-between gap-4">
        <label htmlFor={inputId} className="field-label mb-0">
          Your answer
        </label>
        <p className="flex items-center gap-1.5 font-mono text-eyebrow text-shade">
          <ClockIcon className="size-3.5" />
          <span aria-hidden="true">{clock(seconds)}</span>
        </p>
      </div>

      <textarea
        id={inputId}
        ref={box}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={submitting}
        rows={7}
        className="field-input min-h-40 resize-y leading-relaxed"
        placeholder="Answer out loud first, then type what you said. Rambling is fine — that is what the feedback is for."
        aria-describedby={`${inputId}-hint`}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p id={`${inputId}-hint`} className="font-mono text-eyebrow text-shade">
          {short
            ? `${remaining} more character${remaining === 1 ? '' : 's'} before this can be scored`
            : `${text.trim().length.toLocaleString()} characters`}
        </p>

        <button type="submit" disabled={short || submitting} className="btn-lamp text-sm">
          {submitting ? 'Submitting…' : 'Submit answer'}
        </button>
      </div>

      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-shade">
        You cannot change an answer once it is submitted — the real interview does not
        offer a second attempt either.
      </p>
    </form>
  )
}

function GivenAnswer({ answer }) {
  return (
    <div className="border-t border-seam px-5 py-5">
      <div className="mb-2 flex items-end justify-between gap-4">
        <h4 className="eyebrow">What you said</h4>
        {answer.seconds_taken !== null && answer.seconds_taken !== undefined && (
          <p className="flex items-center gap-1.5 font-mono text-eyebrow text-shade">
            <ClockIcon className="size-3.5" />
            {clock(answer.seconds_taken)}
          </p>
        )}
      </div>
      {/* whitespace-pre-line: they typed paragraphs, so they get paragraphs back. */}
      <p className="leading-relaxed whitespace-pre-line text-lit-soft">{answer.text}</p>
    </div>
  )
}

export default function QuestionCard({
  question,
  total,
  current = false,
  onSubmit,
  submitting = false,
  error,
}) {
  const answer = question.answer

  return (
    <section
      className={`panel overflow-hidden ${current ? 'animate-rise' : ''}`}
      aria-label={`Question ${question.order}`}
    >
      <header className="border-b border-seam bg-flat/60 px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex items-center gap-2 font-mono text-eyebrow uppercase tracking-[0.14em] text-shade">
            <AskIcon className="size-4" />
            Question {question.order}
            {total ? ` of ${total}` : ''}
          </p>
          <CategoryChip category={question.category} />
        </div>

        {/* The question is the largest thing on the card. Everything else on this
            screen is scaffolding around reading it and answering it. */}
        <h3 className="font-display text-lg font-bold leading-snug tracking-[-0.02em] text-lit">
          {question.text}
        </h3>

        {/* Held back until it is answered: beforehand this is the answer key. */}
        {answer && question.focus && (
          <p className="mt-2 font-mono text-eyebrow text-shade">Testing: {question.focus}</p>
        )}
      </header>

      {answer ? (
        <>
          <GivenAnswer answer={answer} />
          <AnswerFeedback evaluation={answer.evaluation} />
        </>
      ) : (
        <AnswerForm
          question={question}
          onSubmit={onSubmit}
          submitting={submitting}
          error={error}
        />
      )}
    </section>
  )
}
