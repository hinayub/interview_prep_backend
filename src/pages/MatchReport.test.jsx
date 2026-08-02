import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import MatchReport from './MatchReport'
import { renderWithStore } from '../test/renderWithStore'
import { stubFetch } from '../test/stubFetch'

const RESUME = { id: 7, filename: 'cv.pdf', parsed_text: 'Python, Django, Redis.' }
const ROLE = { id: 3, title: 'Backend Engineer', company: 'Acme', raw_text: 'x'.repeat(150) }

const PENDING = {
  id: 11,
  resume: 7,
  resume_filename: 'cv.pdf',
  job_description: 3,
  job_title: 'Backend Engineer',
  status: 'pending',
  match_score: null,
  reasoning: '',
  matched_skills: [],
  missing_skills: [],
  error_message: '',
  created_at: '2026-07-28T10:00:00Z',
  completed_at: null,
}

const COMPLETE = {
  ...PENDING,
  status: 'complete',
  match_score: 76,
  reasoning: 'You evidence the Django and Redis work this role leads with.',
  matched_skills: ['Python', 'Django', 'Redis'],
  missing_skills: ['Kubernetes', 'Terraform'],
  completed_at: '2026-07-28T10:00:41Z',
}

const READY = {
  'GET /api/resumes/': { body: [RESUME] },
  'GET /api/job-descriptions/': { body: [ROLE] },
  'GET /api/match-analyses/': { body: [] },
}

function renderPage() {
  return renderWithStore(<MatchReport />, { auth: {}, route: '/app/match' })
}

beforeEach(() => {
  stubFetch(READY)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MatchReport', () => {
  it('sends people back to step 1 when there is nothing to compare', async () => {
    stubFetch({ ...READY, 'GET /api/resumes/': { body: [] }, 'GET /api/job-descriptions/': { body: [] } })
    renderPage()

    expect(await screen.findByText('There is nothing to compare yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to step 1/ })).toHaveAttribute('href', '/app')
    expect(screen.queryByRole('button', { name: 'Run the match' })).not.toBeInTheDocument()
  })

  it('names the CV and the role it is about to compare', async () => {
    renderPage()

    // Scoped to the panel: the sidebar cue names the same file, and a bare text
    // query would pass on the cue alone.
    const panel = (await screen.findByText('What will be compared')).closest('section')
    expect(panel).toHaveTextContent('cv.pdf')
    expect(panel).toHaveTextContent('22 characters read')
    expect(panel).toHaveTextContent('Backend Engineer')
    expect(panel).toHaveTextContent('Acme')
  })

  it('starts the analysis with the newest resume and role', async () => {
    const fetchMock = stubFetch({
      ...READY,
      'POST /api/match-analyses/': { status: 201, body: PENDING },
      'GET /api/match-analyses/11/': { body: PENDING },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Run the match' }))

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    // Ids, not text: the agent re-reads the rows server-side, and sending the text
    // would let the client decide what was analysed.
    await expect(fetchMock.lastOf('POST').json()).resolves.toEqual({
      resume: 7,
      job_description: 3,
    })
  })

  it('says the agent is working, without claiming a score', async () => {
    stubFetch({
      ...READY,
      'POST /api/match-analyses/': { status: 201, body: PENDING },
      'GET /api/match-analyses/11/': { body: PENDING },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Run the match' }))

    expect(await screen.findByText(/20 to 60 seconds/)).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    // A second run while one is in flight would leave two rows racing for the page.
    expect(screen.getByRole('button', { name: 'Analysing…' })).toBeDisabled()
  })

  it('renders the score, the reasoning and both skill lists once complete', async () => {
    stubFetch({
      ...READY,
      'POST /api/match-analyses/': { status: 201, body: PENDING },
      'GET /api/match-analyses/11/': { body: COMPLETE },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Run the match' }))

    expect(await screen.findByText('76')).toBeInTheDocument()
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '76')
    expect(screen.getByText('Strong fit')).toBeInTheDocument()
    expect(screen.getByText(/Django and Redis work/)).toBeInTheDocument()

    expect(screen.getByText('Redis')).toBeInTheDocument()
    expect(screen.getByText('Kubernetes')).toBeInTheDocument()
    // The counts have to come from the arrays, not from a hardcoded label.
    expect(screen.getByText(/What you have/)).toHaveTextContent('3')
    expect(screen.getByText(/What to close/)).toHaveTextContent('2')
  })

  it('polls a pending row until the agent finishes with it', async () => {
    let calls = 0
    stubFetch({
      ...READY,
      'POST /api/match-analyses/': { status: 201, body: PENDING },
      'GET /api/match-analyses/11/': () => {
        calls += 1
        return { body: calls > 1 ? COMPLETE : PENDING }
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Run the match' }))
    expect(await screen.findByText(/comparing your resume against the posting/)).toBeInTheDocument()

    // The interval is 2s; this is the one test that pays for it, because polling
    // silently stopping would leave every candidate staring at "Reading…".
    expect(await screen.findByText('76', {}, { timeout: 6000 })).toBeInTheDocument()
  }, 12000)

  it('shows the failure message the agent recorded, and offers another run', async () => {
    stubFetch({
      ...READY,
      'GET /api/match-analyses/': {
        body: [
          {
            ...PENDING,
            status: 'failed',
            error_message: 'Could not reach Ollama at http://127.0.0.1:11434.',
          },
        ],
      },
      'GET /api/match-analyses/11/': {
        body: {
          ...PENDING,
          status: 'failed',
          error_message: 'Could not reach Ollama at http://127.0.0.1:11434.',
        },
      },
    })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach Ollama')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('reports the movement since the last run of the same pairing', async () => {
    stubFetch({
      ...READY,
      // Newest first, as the API returns them.
      'GET /api/match-analyses/': { body: [COMPLETE, { ...COMPLETE, id: 4, match_score: 61 }] },
      'GET /api/match-analyses/11/': { body: COMPLETE },
    })
    renderPage()

    expect(await screen.findByText(/\+15 since your last run/)).toBeInTheDocument()
  })

  it('says nothing about movement when this is the first run', async () => {
    stubFetch({
      ...READY,
      'GET /api/match-analyses/': { body: [COMPLETE] },
      'GET /api/match-analyses/11/': { body: COMPLETE },
    })
    renderPage()

    await screen.findByText('76')
    expect(screen.queryByText(/since your last run/)).not.toBeInTheDocument()
  })

  it('picks up the newest analysis on a reload rather than starting over', async () => {
    stubFetch({
      ...READY,
      'GET /api/match-analyses/': { body: [COMPLETE] },
      'GET /api/match-analyses/11/': { body: COMPLETE },
    })
    renderPage()

    expect(await screen.findByText('76')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeInTheDocument()
  })
})
