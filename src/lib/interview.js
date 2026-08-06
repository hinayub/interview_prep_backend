/**
 * Reading an interview session the way the screen needs it.
 *
 * The server sends the whole rehearsal in one payload and says nothing about where
 * the candidate is in it — deliberately, because "where am I" is a view concern and
 * the answer changes as they navigate. All of it is derived here rather than held in
 * component state, so a reload lands them exactly where they left off.
 */

/**
 * The bands an answer score is judged against.
 *
 * Deliberately the same three-band scale as the match score (see MatchScore.jsx)
 * and the same boundaries the evaluator is told to score against in
 * agents/evaluator.py — 0-39 weak, 40-69 partial, 70-100 strong. A candidate
 * should not have to learn a second scale halfway through the product.
 */
const BANDS = [
  {
    key: 'weak',
    max: 40,
    label: 'Needs work',
    chip: 'border-tally/35 bg-tally/12 text-tally',
    bar: 'bg-tally',
  },
  {
    key: 'partial',
    max: 70,
    label: 'Getting there',
    chip: 'border-sodium/35 bg-sodium/12 text-sodium',
    bar: 'bg-sodium',
  },
  {
    key: 'strong',
    max: 101,
    label: 'Strong',
    chip: 'border-jade/35 bg-jade/12 text-jade',
    bar: 'bg-jade',
  },
]

export function bandForAnswer(score) {
  return BANDS.find((band) => score < band.max) ?? BANDS.at(-1)
}

/** How a category reads to the candidate, rather than how it is stored. */
export const CATEGORY_LABELS = {
  technical: 'Technical',
  experience: 'Experience',
  behavioural: 'Behavioural',
  gap: 'Skill gap',
}

/**
 * What the candidate is meant to be doing right now.
 *
 * The first unanswered question is where the interview is. Once every question has
 * an answer the interview is over and the debrief is what remains — that is the
 * whole state machine, and it comes entirely from the server's rows.
 */
export function firstUnansweredIndex(questions = []) {
  const index = questions.findIndex((question) => !question.answer)
  return index === -1 ? null : index
}

export function isFinished(session) {
  const questions = session?.questions ?? []
  return questions.length > 0 && firstUnansweredIndex(questions) === null
}

/**
 * Has every answer's score arrived, one way or the other?
 *
 * Terminal rather than complete: an evaluation that failed is never coming back, and
 * treating it as outstanding would mean the debrief was never written at all over one
 * answer Gemini refused.
 */
export function isScoringSettled(session) {
  return (session?.questions ?? []).every(
    (question) => question.answer?.evaluation?.status !== 'pending'
  )
}

/**
 * Every question answered and every score in — the debrief can now cover all of it.
 *
 * The debrief is written over *scored* answers, so asking for it the moment the last
 * answer is submitted would build it over the answers scored so far and land it
 * already flagged out of date, with the candidate told to re-run something they never
 * asked for once.
 */
export function isReadyForReport(session) {
  // The last clause is not redundant: a score that failed counts as settled, so a
  // session whose every evaluation failed would otherwise auto-request a debrief the
  // server can only reject for having nothing to read.
  return isFinished(session) && isScoringSettled(session) && scoredAnswers(session).length > 0
}

/**
 * Answers whose score failed, and so is never arriving without a retry.
 *
 * Worth surfacing at the session level rather than only under each answer, because
 * the usual cause is configuration — an unset key, a retired model — which fails
 * every answer at once and is fixed for all of them at once.
 */
export function failedScores(session) {
  return (session?.questions ?? []).filter(
    (question) => question.answer?.evaluation?.status === 'failed'
  )
}

/** Answers that have come back with a score, in the order they were asked. */
export function scoredAnswers(session) {
  return (session?.questions ?? []).filter(
    (question) => question.answer?.evaluation?.status === 'complete'
  )
}

/**
 * The candidate's running average across scored answers.
 *
 * Shown while the interview is in progress, where the report's overall_score does
 * not exist yet. Once the report lands its own number is used instead — the model is
 * allowed to depart from the average, and two different numbers on one screen would
 * be worse than either.
 */
export function runningAverage(session) {
  const scored = scoredAnswers(session)
  if (!scored.length) return null

  const total = scored.reduce((sum, question) => sum + question.answer.evaluation.score, 0)
  return Math.round(total / scored.length)
}

/**
 * Per-category averages, for the breakdown in the debrief.
 *
 * This is the "skill-area breakdown" the landing page promises. Categories with no
 * scored answer are left out entirely rather than shown as zero, which would read as
 * having failed something that was never asked.
 */
export function categoryBreakdown(session) {
  const totals = new Map()

  for (const question of scoredAnswers(session)) {
    const entry = totals.get(question.category) ?? { total: 0, count: 0 }
    entry.total += question.answer.evaluation.score
    entry.count += 1
    totals.set(question.category, entry)
  }

  return [...totals.entries()]
    .map(([category, { total, count }]) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      score: Math.round(total / count),
      count,
    }))
    .sort((a, b) => a.score - b.score)
}

/**
 * How the readiness verdict should be dressed.
 *
 * Mapped rather than styled inline because the report renders it in two places and
 * an unrecognised value must degrade to something neutral rather than to nothing.
 */
export const READINESS = {
  'not ready': {
    label: 'Not ready yet',
    chip: 'border-tally/35 bg-tally/12 text-tally',
  },
  'nearly ready': {
    label: 'Nearly ready',
    chip: 'border-sodium/35 bg-sodium/12 text-sodium',
  },
  ready: {
    label: 'Ready',
    chip: 'border-jade/35 bg-jade/12 text-jade',
  },
}

export function readinessFor(value) {
  return READINESS[value] ?? { label: value || 'Assessed', chip: 'border-seam bg-house text-dusk' }
}
