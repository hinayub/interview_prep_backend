import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Interview from './Interview'
import { renderWithStore } from '../test/renderWithStore'
import { stubFetch } from '../test/stubFetch'

const RESUME = { id: 7, filename: 'cv.pdf', parsed_text: 'Python, Django, Celery.' }
const ROLE = { id: 3, title: 'Backend Engineer', company: 'Acme', raw_text: 'x'.repeat(150) }
const ANALYSIS = {
  id: 5,
  status: 'complete',
  match_score: 72,
  job_title: 'Backend Engineer',
  missing_skills: ['Kubernetes', 'Terraform'],
  matched_skills: ['Python'],
}

function question(order, { text, category = 'technical', focus = 'a focus', answer = null } = {}) {
  return {
    id: order * 10,
    order,
    text: text ?? `Question ${order} text?`,
    category,
    category_label: category,
    focus,
    answer,
  }
}

function answer({ text = 'What I said in the interview.', evaluation }) {
  return { id: 1, text, seconds_taken: 45, submitted_at: '2026-07-28T10:00:00Z', evaluation }
}

const SCORED = {
  id: 1,
  status: 'complete',
  score: 74,
  verdict: 'You named the specific failure, which is what makes this land.',
  strengths: ['Named the real service'],
  improvements: ['Give the row count'],
  model_answer: 'A strong answer opens with the idempotency bug.',
  error_message: '',
}

const GENERATING = {
  id: 11,
  resume: 7,
  resume_filename: 'cv.pdf',
  job_description: 3,
  job_title: 'Backend Engineer',
  company: 'Acme',
  match_analysis: 5,
  status: 'pending',
  error_message: '',
  question_count: 0,
  answered_count: 0,
  questions: [],
  report: null,
  created_at: '2026-07-28T10:00:00Z',
  completed_at: null,
}

const OPEN = {
  ...GENERATING,
  status: 'complete',
  question_count: 2,
  answered_count: 0,
  questions: [
    question(1, { text: 'You migrated a monolith to Celery — what broke first?' }),
    question(2, { text: 'Tell me about a disagreement over a design.', category: 'behavioural' }),
  ],
  completed_at: '2026-07-28T10:00:40Z',
}

const READY = {
  'GET /api/resumes/': { body: [RESUME] },
  'GET /api/job-descriptions/': { body: [ROLE] },
  'GET /api/match-analyses/': { body: [ANALYSIS] },
  'GET /api/interviews/': { body: [] },
}

function renderPage() {
  return renderWithStore(<Interview />, { auth: {}, route: '/app/interview' })
}

beforeEach(() => {
  stubFetch(READY)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Interview', () => {
  it('sends people back to step 1 when there is no CV or role', async () => {
    stubFetch({
      ...READY,
      'GET /api/resumes/': { body: [] },
      'GET /api/job-descriptions/': { body: [] },
    })
    renderPage()

    expect(await screen.findByText('There is no interview to sit yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to step 1/ })).toHaveAttribute('href', '/app')
    expect(screen.queryByRole('button', { name: 'Start the interview' })).not.toBeInTheDocument()
  })

  it('says how many gaps the questions will probe', async () => {
    renderPage()

    expect(await screen.findByText('2 gaps will be probed')).toBeInTheDocument()
  })

  it('says so when there is no match to target, rather than hiding it', async () => {
    stubFetch({ ...READY, 'GET /api/match-analyses/': { body: [] } })
    renderPage()

    expect(await screen.findByText(/questions from the documents alone/)).toBeInTheDocument()
  })

  it('links the match analysis when starting, so the gaps reach the agent', async () => {
    const fetchMock = stubFetch({
      ...READY,
      'POST /api/interviews/': { status: 201, body: GENERATING },
      'GET /api/interviews/11/': { body: GENERATING },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Start the interview' }))

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    await expect(fetchMock.lastOf('POST').json()).resolves.toEqual({
      resume: 7,
      job_description: 3,
      match_analysis: 5,
    })
  })

  it('omits the analysis rather than sending null when there is none', async () => {
    const fetchMock = stubFetch({
      ...READY,
      'GET /api/match-analyses/': { body: [] },
      'POST /api/interviews/': { status: 201, body: { ...GENERATING, match_analysis: null } },
      'GET /api/interviews/11/': { body: { ...GENERATING, match_analysis: null } },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Start the interview' }))

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    await expect(fetchMock.lastOf('POST').json()).resolves.toEqual({
      resume: 7,
      job_description: 3,
    })
  })

  it('says the questions are being written, without showing any', async () => {
    stubFetch({
      ...READY,
      'POST /api/interviews/': { status: 201, body: GENERATING },
      'GET /api/interviews/11/': { body: GENERATING },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Start the interview' }))

    expect(await screen.findByText(/30 to 90 seconds/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    // A second start while one is in flight would leave two sessions racing.
    expect(screen.getByRole('button', { name: 'Writing questions…' })).toBeDisabled()
  })

  it('shows one question at a time, not the whole list', async () => {
    // Seeing question two while answering question one is not what the real
    // interview does, and it lets the candidate prepare out of order.
    stubFetch({ ...READY, 'GET /api/interviews/': { body: [OPEN] }, 'GET /api/interviews/11/': { body: OPEN } })
    renderPage()

    expect(await screen.findByText(/what broke first\?/)).toBeInTheDocument()
    expect(screen.queryByText(/disagreement over a design/)).not.toBeInTheDocument()
  })

  it('withholds what the question is testing until it has been answered', async () => {
    stubFetch({ ...READY, 'GET /api/interviews/': { body: [OPEN] }, 'GET /api/interviews/11/': { body: OPEN } })
    renderPage()

    await screen.findByText(/what broke first\?/)
    expect(screen.queryByText(/Testing:/)).not.toBeInTheDocument()
  })

  it('will not submit an answer too short to be scored', async () => {
    stubFetch({ ...READY, 'GET /api/interviews/': { body: [OPEN] }, 'GET /api/interviews/11/': { body: OPEN } })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText(/what broke first\?/)
    await user.type(screen.getByRole('textbox'), 'dunno')

    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    expect(screen.getByText(/35 more characters before this can be scored/)).toBeInTheDocument()
  })

  it('submits the answer against the question being shown', async () => {
    const fetchMock = stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [OPEN] },
      'GET /api/interviews/11/': { body: OPEN },
      'POST /api/interviews/11/answers/': { status: 201, body: {} },
    })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText(/what broke first\?/)
    await user.type(
      screen.getByRole('textbox'),
      'Task idempotency broke first, so retries double-charged.'
    )
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    const body = await fetchMock.lastOf('POST').json()
    expect(body.question).toBe(10)
    expect(body.text).toBe('Task idempotency broke first, so retries double-charged.')
    // Self-reported timing, for the record afterwards.
    expect(body).toHaveProperty('seconds_taken')
  })

  it('shows the score, the feedback and the model answer once scored', async () => {
    const answered = {
      ...OPEN,
      answered_count: 1,
      questions: [
        { ...OPEN.questions[0], answer: answer({ evaluation: SCORED }) },
        OPEN.questions[1],
      ],
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [answered] },
      'GET /api/interviews/11/': { body: answered },
    })
    renderPage()

    // The interview has moved on to question two, so question one's feedback is
    // reached by looking back at it.
    expect(await screen.findByText(/disagreement over a design/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Question 1' }))

    // Scoped to the card: the rail marker carries the same score, and a bare text
    // query would pass on the marker alone.
    const card = await screen.findByRole('region', { name: 'Question 1' })
    expect(within(card).getByText('74')).toBeInTheDocument()
    expect(within(card).getByText(/named the specific failure/)).toBeInTheDocument()
    expect(within(card).getByText('Named the real service')).toBeInTheDocument()
    expect(within(card).getByText('Give the row count')).toBeInTheDocument()
    expect(within(card).getByText(/opens with the idempotency bug/)).toBeInTheDocument()
    // Only now is it safe to say what the question was probing.
    expect(within(card).getByText(/Testing: a focus/)).toBeInTheDocument()
  })

  it('says an answer is being scored without claiming a number', async () => {
    const scoring = {
      ...OPEN,
      answered_count: 1,
      questions: [
        {
          ...OPEN.questions[0],
          answer: answer({ evaluation: { id: 1, status: 'pending', score: null, error_message: '' } }),
        },
        OPEN.questions[1],
      ],
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [scoring] },
      'GET /api/interviews/11/': { body: scoring },
    })
    renderPage()

    await screen.findByText(/disagreement over a design/)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Question 1' }))

    expect(await screen.findByText('Scoring your answer')).toBeInTheDocument()
  })

  it('keeps the answer and carries on when one answer cannot be scored', async () => {
    const failed = {
      ...OPEN,
      answered_count: 1,
      questions: [
        {
          ...OPEN.questions[0],
          answer: answer({
            evaluation: {
              id: 1,
              status: 'failed',
              score: null,
              error_message: 'No Gemini API key is configured.',
            },
          }),
        },
        OPEN.questions[1],
      ],
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [failed] },
      'GET /api/interviews/11/': { body: failed },
    })
    renderPage()

    await screen.findByText(/disagreement over a design/)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Question 1' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No Gemini API key')
    expect(screen.getByText(/Your answer is saved either way/)).toBeInTheDocument()
    expect(screen.getByText('What I said in the interview.')).toBeInTheDocument()
  })

  it('shows the failure the generator recorded, and offers another run', async () => {
    const failed = {
      ...GENERATING,
      status: 'failed',
      error_message: 'Cannot reach Ollama at http://localhost:11434.',
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [failed] },
      'GET /api/interviews/11/': { body: failed },
    })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach Ollama')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('does not ask for the debrief while questions are still unanswered', async () => {
    const halfway = {
      ...OPEN,
      answered_count: 1,
      questions: [
        { ...OPEN.questions[0], answer: answer({ evaluation: SCORED }) },
        OPEN.questions[1],
      ],
    }
    const fetchMock = stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [halfway] },
      'GET /api/interviews/11/': { body: halfway },
    })
    renderPage()

    await screen.findByText(/disagreement over a design/)
    // No POST stubbed for the report, so an early request would throw rather than
    // quietly pass — but assert on it directly too, since that failure is unhandled.
    expect(fetchMock.lastOf('POST')).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Write my debrief' })).not.toBeInTheDocument()
  })

  it('runs the running average off scored answers while in progress', async () => {
    const halfway = {
      ...OPEN,
      answered_count: 1,
      questions: [
        { ...OPEN.questions[0], answer: answer({ evaluation: SCORED }) },
        OPEN.questions[1],
      ],
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [halfway] },
      'GET /api/interviews/11/': { body: halfway },
    })
    renderPage()

    const panel = (await screen.findByText('Running average')).closest('div')
    expect(panel).toHaveTextContent('74')
  })

  it('asks for the debrief itself once the interview is done', async () => {
    const finished = {
      ...OPEN,
      answered_count: 2,
      questions: OPEN.questions.map((q) => ({ ...q, answer: answer({ evaluation: SCORED }) })),
    }
    const fetchMock = stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [finished] },
      'GET /api/interviews/11/': { body: finished },
      'POST /api/interviews/11/report/': { status: 201, body: { id: 2, status: 'pending' } },
    })
    renderPage()

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    expect(new URL(fetchMock.lastOf('POST').url).pathname).toBe('/api/interviews/11/report/')
    // Nothing left to press: answering the last question was the request.
    expect(screen.queryByRole('button', { name: 'Write my debrief' })).not.toBeInTheDocument()
  })

  it('asks only once, however many times the session is polled back', async () => {
    const finished = {
      ...OPEN,
      answered_count: 2,
      questions: OPEN.questions.map((q) => ({ ...q, answer: answer({ evaluation: SCORED }) })),
    }
    const fetchMock = stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [finished] },
      // Still reporting no report, as it does between the POST and the row landing.
      'GET /api/interviews/11/': { body: finished },
      'POST /api/interviews/11/report/': { status: 201, body: { id: 2, status: 'pending' } },
    })
    renderPage()

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())

    // Wait for the refetch the POST's own invalidation triggers. That read still
    // carries report: null, so it re-runs the effect on a session that looks exactly
    // as it did before — the ref guard is the only thing stopping a second Gemini call.
    const posted = fetchMock.requests.findIndex((r) => r.method === 'POST')
    await waitFor(() =>
      expect(fetchMock.requests.slice(posted).filter((r) => r.method === 'GET')).not.toHaveLength(0)
    )

    expect(fetchMock.requests.filter((r) => r.method === 'POST')).toHaveLength(1)
  })

  it('waits for the last score, so the debrief is not written over half the answers', async () => {
    const scoring = {
      ...OPEN,
      answered_count: 2,
      questions: [
        { ...OPEN.questions[0], answer: answer({ evaluation: SCORED }) },
        {
          ...OPEN.questions[1],
          answer: answer({ evaluation: { ...SCORED, status: 'pending', score: null } }),
        },
      ],
    }
    const fetchMock = stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [scoring] },
      'GET /api/interviews/11/': { body: scoring },
    })
    renderPage()

    expect(await screen.findByText(/starts as soon as the last score lands/)).toBeInTheDocument()
    expect(fetchMock.lastOf('POST')).toBeUndefined()
  })

  it('offers a re-score when an answer could not be scored, and asks for no debrief', async () => {
    const FAILED_SCORE = {
      id: 1,
      status: 'failed',
      score: null,
      verdict: '',
      strengths: [],
      improvements: [],
      model_answer: '',
      error_message: 'No Gemini API key is configured, so answers cannot be evaluated.',
    }
    const broken = {
      ...OPEN,
      answered_count: 2,
      questions: OPEN.questions.map((q) => ({
        ...q,
        answer: answer({ evaluation: FAILED_SCORE }),
      })),
    }
    const fetchMock = stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [broken] },
      'GET /api/interviews/11/': { body: broken },
      'POST /api/interviews/11/rescore/': { body: broken },
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('None of your answers could be scored')).toBeInTheDocument()
    // No debrief is requested: there is nothing scored for it to read, so asking is a
    // call the server can only reject.
    expect(fetchMock.lastOf('POST')).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Score those answers again' }))

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    expect(new URL(fetchMock.lastOf('POST').url).pathname).toBe('/api/interviews/11/rescore/')
  })

  it('names how many answers went unscored when only some did', async () => {
    const partly = {
      ...OPEN,
      answered_count: 2,
      questions: [
        { ...OPEN.questions[0], answer: answer({ evaluation: SCORED }) },
        {
          ...OPEN.questions[1],
          answer: answer({
            evaluation: { ...SCORED, status: 'failed', score: null, error_message: 'Blocked.' },
          }),
        },
      ],
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [partly] },
      'GET /api/interviews/11/': { body: partly },
      'POST /api/interviews/11/report/': { status: 201, body: { id: 2, status: 'pending' } },
    })
    renderPage()

    expect(
      await screen.findByText('1 of your 2 answers could not be scored')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Score that answer again' })).toBeEnabled()
  })

  it('renders the debrief with its breakdown once it lands', async () => {
    const debriefed = {
      ...OPEN,
      answered_count: 2,
      questions: [
        { ...OPEN.questions[0], answer: answer({ evaluation: SCORED }) },
        {
          ...OPEN.questions[1],
          answer: answer({ evaluation: { ...SCORED, score: 40 } }),
        },
      ],
      report: {
        id: 2,
        status: 'complete',
        overall_score: 61,
        headline: 'Strong on specifics, vague on collaboration.',
        summary: 'Your technical answers carry real numbers. The behavioural ones do not.',
        strengths: ['Concrete technical detail'],
        priorities: ['Prepare two collaboration stories'],
        readiness: 'nearly ready',
        answers_covered: 2,
        is_stale: false,
        error_message: '',
      },
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [debriefed] },
      'GET /api/interviews/11/': { body: debriefed },
    })
    renderPage()

    expect(
      await screen.findByText('Strong on specifics, vague on collaboration.')
    ).toBeInTheDocument()
    expect(screen.getByText('Nearly ready')).toBeInTheDocument()
    expect(screen.getByText(/carry real numbers/)).toBeInTheDocument()
    expect(screen.getByText('Prepare two collaboration stories')).toBeInTheDocument()

    // Weakest area first: behavioural scored 40 against technical's 74. The overall
    // score rides its own meter, which is not one of the breakdown rows.
    const areas = screen
      .getAllByRole('meter')
      .map((meter) => meter.getAttribute('aria-label'))
      .filter((label) => label !== 'Match score')
    expect(areas).toEqual(['Behavioural', 'Technical'])
    expect(screen.getByText('Written over 2 answers')).toBeInTheDocument()
  })

  it('warns that a debrief is out of date once more answers arrive', async () => {
    const stale = {
      ...OPEN,
      answered_count: 2,
      questions: OPEN.questions.map((q) => ({ ...q, answer: answer({ evaluation: SCORED }) })),
      report: {
        id: 2,
        status: 'complete',
        overall_score: 61,
        headline: 'A headline.',
        summary: 'A summary.',
        strengths: [],
        priorities: [],
        readiness: 'ready',
        answers_covered: 1,
        is_stale: true,
        error_message: '',
      },
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [stale] },
      'GET /api/interviews/11/': { body: stale },
    })
    renderPage()

    expect(await screen.findByText(/out of date/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update the debrief' })).toBeEnabled()
  })

  it('picks the interview back up on a reload rather than starting over', async () => {
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [OPEN] },
      'GET /api/interviews/11/': { body: OPEN },
    })
    renderPage()

    expect(await screen.findByText(/what broke first\?/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a fresh interview' })).toBeInTheDocument()
  })

  it('polls until the questions arrive', async () => {
    let calls = 0
    stubFetch({
      ...READY,
      'POST /api/interviews/': { status: 201, body: GENERATING },
      'GET /api/interviews/11/': () => {
        calls += 1
        return { body: calls > 1 ? OPEN : GENERATING }
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Start the interview' }))
    expect(await screen.findByText(/30 to 90 seconds/)).toBeInTheDocument()

    // The interval is 2s. This is the one test that pays for it, because polling
    // silently stopping would leave every candidate staring at "Writing questions…".
    expect(
      await screen.findByText(/what broke first\?/, {}, { timeout: 6000 })
    ).toBeInTheDocument()
  }, 12000)

  it('keeps polling for a score after the questions have landed', async () => {
    // Polling on session.status alone would stop here and strand the evaluation.
    const scoring = {
      ...OPEN,
      answered_count: 2,
      questions: OPEN.questions.map((q) => ({
        ...q,
        answer: answer({ evaluation: { id: 1, status: 'pending', score: null, error_message: '' } }),
      })),
    }
    let calls = 0
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [scoring] },
      'GET /api/interviews/11/': () => {
        calls += 1
        if (calls <= 1) return { body: scoring }
        return {
          body: {
            ...scoring,
            questions: scoring.questions.map((q) => ({
              ...q,
              answer: answer({ evaluation: SCORED }),
            })),
          },
        }
      },
    })
    renderPage()

    expect(await screen.findByText('Scoring your answer')).toBeInTheDocument()

    const card = await screen.findByRole('region', { name: 'Question 2' })
    await waitFor(() => expect(within(card).getByText('74')).toBeInTheDocument(), {
      timeout: 6000,
    })
  }, 12000)

  it('marks each answered question with the score it got', async () => {
    const finished = {
      ...OPEN,
      answered_count: 2,
      questions: [
        { ...OPEN.questions[0], answer: answer({ evaluation: SCORED }) },
        { ...OPEN.questions[1], answer: answer({ evaluation: { ...SCORED, score: 41 } }) },
      ],
    }
    stubFetch({
      ...READY,
      'GET /api/interviews/': { body: [finished] },
      'GET /api/interviews/11/': { body: finished },
    })
    renderPage()

    const rail = await screen.findByRole('navigation', { name: 'Interview progress' })
    expect(within(rail).getByRole('button', { name: 'Question 1' })).toHaveTextContent('74')
    expect(within(rail).getByRole('button', { name: 'Question 2' })).toHaveTextContent('41')
  })
})
