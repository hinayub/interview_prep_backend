import { describe, expect, it } from 'vitest'

import {
  bandForAnswer,
  categoryBreakdown,
  failedScores,
  firstUnansweredIndex,
  isFinished,
  isReadyForReport,
  readinessFor,
  runningAverage,
  scoredAnswers,
} from './interview'

/**
 * Where the interview is, and what it adds up to.
 *
 * All of this is derived from the server payload rather than held in component
 * state, so it is tested here directly — the guarantee being that a reload cannot
 * lose the candidate's place.
 */

function question(order, { score, category = 'technical', answered = score !== undefined } = {}) {
  return {
    id: order,
    order,
    category,
    text: `Question ${order}?`,
    answer: answered
      ? {
          id: order,
          text: 'An answer.',
          evaluation:
            score === undefined
              ? { status: 'pending', score: null }
              : { status: 'complete', score },
        }
      : null,
  }
}

describe('firstUnansweredIndex', () => {
  it('is where the interview actually is', () => {
    expect(firstUnansweredIndex([question(1, { score: 70 }), question(2), question(3)])).toBe(1)
  })

  it('is null once every question has an answer', () => {
    expect(firstUnansweredIndex([question(1, { score: 70 })])).toBeNull()
  })

  it('counts an answer that is still being scored as answered', () => {
    // Otherwise submitting would bounce the candidate back to the question they
    // just committed to, and invite them to answer it twice.
    expect(firstUnansweredIndex([question(1, { answered: true }), question(2)])).toBe(1)
  })
})

describe('isFinished', () => {
  it('is false for a session whose questions have not been written yet', () => {
    // A pending session has an empty questions array, which must not read as "done".
    expect(isFinished({ status: 'pending', questions: [] })).toBe(false)
  })

  it('is false while any question is unanswered', () => {
    expect(isFinished({ questions: [question(1, { score: 70 }), question(2)] })).toBe(false)
  })

  it('is true once all of them are answered', () => {
    expect(isFinished({ questions: [question(1, { score: 70 }), question(2, { score: 40 })] })).toBe(
      true
    )
  })
})

describe('isReadyForReport', () => {
  it('is false while a question is unanswered', () => {
    expect(isReadyForReport({ questions: [question(1, { score: 70 }), question(2)] })).toBe(false)
  })

  it('is false while a score is still coming back', () => {
    // Asking now would build the debrief over one of two answers and land it already
    // flagged out of date.
    const session = { questions: [question(1, { score: 70 }), question(2, { answered: true })] }
    expect(isReadyForReport(session)).toBe(false)
  })

  it('is true once every score is in', () => {
    const session = { questions: [question(1, { score: 70 }), question(2, { score: 40 })] }
    expect(isReadyForReport(session)).toBe(true)
  })

  it('does not wait on a score that failed and is never coming', () => {
    const failed = question(2, { answered: true })
    failed.answer.evaluation = { status: 'failed', score: null }

    expect(isReadyForReport({ questions: [question(1, { score: 70 }), failed] })).toBe(true)
  })

  it('is false when every score failed, leaving nothing to write from', () => {
    // Requesting it anyway is a call the server can only reject for having nothing
    // to read — which is what a missing API key used to produce.
    const questions = [question(1, { answered: true }), question(2, { answered: true })]
    for (const q of questions) q.answer.evaluation = { status: 'failed', score: null }

    expect(isReadyForReport({ questions })).toBe(false)
  })
})

describe('failedScores', () => {
  it('finds the answers whose score is never arriving on its own', () => {
    const failed = question(2, { answered: true })
    failed.answer.evaluation = { status: 'failed', score: null }
    const session = { questions: [question(1, { score: 70 }), failed, question(3)] }

    expect(failedScores(session).map((q) => q.order)).toEqual([2])
  })

  it('is empty while a score is merely still coming back', () => {
    const session = { questions: [question(1, { answered: true })] }

    expect(failedScores(session)).toHaveLength(0)
  })
})

describe('scoredAnswers', () => {
  it('ignores answers that are still being scored', () => {
    const session = {
      questions: [question(1, { score: 70 }), question(2, { answered: true }), question(3)],
    }

    expect(scoredAnswers(session).map((q) => q.order)).toEqual([1])
  })
})

describe('runningAverage', () => {
  it('averages only the answers that came back with a score', () => {
    const session = {
      questions: [question(1, { score: 80 }), question(2, { score: 60 }), question(3)],
    }

    expect(runningAverage(session)).toBe(70)
  })

  it('rounds rather than showing a fraction of a point', () => {
    const session = { questions: [question(1, { score: 80 }), question(2, { score: 61 })] }

    expect(runningAverage(session)).toBe(71)
  })

  it('is null before anything has been scored, rather than zero', () => {
    // Zero is a score. "No score yet" has to be distinguishable from "you got 0".
    expect(runningAverage({ questions: [question(1)] })).toBeNull()
  })
})

describe('categoryBreakdown', () => {
  it('averages within each category', () => {
    const session = {
      questions: [
        question(1, { score: 90, category: 'technical' }),
        question(2, { score: 70, category: 'technical' }),
        question(3, { score: 40, category: 'behavioural' }),
      ],
    }

    expect(categoryBreakdown(session)).toEqual([
      { category: 'behavioural', label: 'Behavioural', score: 40, count: 1 },
      { category: 'technical', label: 'Technical', score: 80, count: 2 },
    ])
  })

  it('puts the weakest area first, because that is what to work on', () => {
    const session = {
      questions: [
        question(1, { score: 95, category: 'technical' }),
        question(2, { score: 20, category: 'gap' }),
        question(3, { score: 55, category: 'experience' }),
      ],
    }

    expect(categoryBreakdown(session).map((row) => row.category)).toEqual([
      'gap',
      'experience',
      'technical',
    ])
  })

  it('leaves out a category that was never scored', () => {
    // Showing it as zero would read as having failed something never asked.
    const session = { questions: [question(1, { score: 60, category: 'technical' })] }

    expect(categoryBreakdown(session)).toHaveLength(1)
  })

  it('is empty when nothing has been scored', () => {
    expect(categoryBreakdown({ questions: [question(1)] })).toEqual([])
  })
})

describe('bandForAnswer', () => {
  it('uses the same boundaries the evaluator scores against', () => {
    expect(bandForAnswer(39).key).toBe('weak')
    expect(bandForAnswer(40).key).toBe('partial')
    expect(bandForAnswer(69).key).toBe('partial')
    expect(bandForAnswer(70).key).toBe('strong')
    expect(bandForAnswer(100).key).toBe('strong')
  })
})

describe('readinessFor', () => {
  it('labels the three verdicts the model may return', () => {
    expect(readinessFor('ready').label).toBe('Ready')
    expect(readinessFor('not ready').label).toBe('Not ready yet')
    expect(readinessFor('nearly ready').label).toBe('Nearly ready')
  })

  it('degrades to something neutral rather than rendering nothing', () => {
    expect(readinessFor(undefined).label).toBe('Assessed')
  })
})
