import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import UploadResume from './UploadResume'
import { renderWithStore } from '../test/renderWithStore'
import { stubFetch } from '../test/stubFetch'

const PARSED = 'Jane Q. Candidate\nSenior Backend Engineer\nPython, Django, Redis.'

const EMPTY_LISTS = {
  'GET /api/resumes/': { body: [] },
  'GET /api/job-descriptions/': { body: [] },
  // The page reads past analyses to light the third cue.
  'GET /api/match-analyses/': { body: [] },
  // ...and past interviews, for the fourth cue and for the history rail.
  'GET /api/interviews/': { body: [] },
}

const PDF = () => new File(['%PDF-1.4 fake'], 'cv.pdf', { type: 'application/pdf' })

function renderPage({ route = '/app' } = {}) {
  return renderWithStore(<UploadResume />, { auth: {}, route })
}

/**
 * The application this tab is already working on.
 *
 * The page reads its pair out of sessionStorage rather than off the newest rows on
 * file, so a test that wants a CV and a posting already in hand has to say which
 * ones — the same way the funnel does when it puts them there.
 */
function onTheBench(pair) {
  sessionStorage.setItem('greenroom.draft.pair', JSON.stringify(pair))
}

function fileInput() {
  return document.getElementById('resume-file')
}

beforeEach(() => {
  stubFetch(EMPTY_LISTS)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UploadResume', () => {
  it('starts with both cue lamps dark', async () => {
    renderPage()

    expect(await screen.findByText('No CV uploaded yet')).toBeInTheDocument()
    expect(screen.getByText('No job description yet')).toBeInTheDocument()
  })

  it('uploads a CV and shows the extracted text', async () => {
    stubFetch({
      ...EMPTY_LISTS,
      'POST /api/resumes/': {
        status: 201,
        body: { id: 1, filename: 'cv.pdf', parsed_text: PARSED, uploaded_at: '2026-07-27T10:00:00Z' },
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.upload(fileInput(), PDF())

    expect(await screen.findByText('What we read')).toBeInTheDocument()
    expect(screen.getByText(/Senior Backend Engineer/)).toBeInTheDocument()
  })

  it('lights the CV cue lamp with the parsed character count', async () => {
    stubFetch({
      ...EMPTY_LISTS,
      'POST /api/resumes/': { status: 201, body: { id: 1, filename: 'cv.pdf', parsed_text: PARSED } },
    })
    const user = userEvent.setup()
    renderPage()

    await user.upload(fileInput(), PDF())

    expect(await screen.findByText(`cv.pdf · ${PARSED.length} chars`)).toBeInTheDocument()
  })

  it('sends the CV as multipart form data, letting the browser set the boundary', async () => {
    const fetchMock = stubFetch({
      ...EMPTY_LISTS,
      'POST /api/resumes/': { status: 201, body: { id: 1, filename: 'cv.pdf', parsed_text: PARSED } },
    })
    const user = userEvent.setup()
    renderPage()

    await user.upload(fileInput(), PDF())

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    const post = fetchMock.lastOf('POST')

    // The boundary is the assertion that matters: hand-setting Content-Type to
    // application/json (or anything without a boundary) silently breaks uploads.
    expect(post.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/)
    await expect(post.text()).resolves.toContain('name="file"')
  })

  it('only offers the file types the backend can parse', () => {
    renderPage()

    // The server enforces this too; the accept filter just stops a doomed upload
    // before it leaves the browser.
    expect(fileInput()).toHaveAttribute('accept', '.pdf,.docx')
  })

  it('attaches the bearer token', async () => {
    const fetchMock = stubFetch(EMPTY_LISTS)
    renderPage()

    await waitFor(() => expect(fetchMock.requests.length).toBeGreaterThan(0))
    expect(fetchMock.requests[0].headers.get('Authorization')).toBe('Bearer test-token')
  })

  it('shows the server message when the CV cannot be read', async () => {
    // The realistic rejection is a scanned PDF: it passes the accept filter and
    // only the server can tell there is no text layer.
    stubFetch({
      ...EMPTY_LISTS,
      'POST /api/resumes/': {
        status: 400,
        body: {
          file: [
            'Almost no text could be extracted from this file (0 characters). If it is a scanned or image-only PDF, please upload a text-based version.',
          ],
        },
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.upload(fileInput(), PDF())

    expect(await screen.findByRole('alert')).toHaveTextContent('scanned or image-only PDF')
    expect(screen.queryByText('What we read')).not.toBeInTheDocument()
    expect(screen.getByText('No CV uploaded yet')).toBeInTheDocument()
  })

  it('blocks a too-short job description before it reaches the server', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Job title'), 'Backend Engineer')
    await user.type(screen.getByLabelText('Job description'), 'Build things.')

    expect(screen.getByRole('button', { name: /^Go/ })).toBeDisabled()
    expect(screen.getByText(/Paste more of the posting/)).toBeInTheDocument()
  })

  /**
   * The role form's one button.
   *
   * There is no "save" here. Saving the posting is a step the funnel needs, not a
   * decision anybody came to make, so the control says what it does — go — and the
   * INSERT happens on the way.
   */
  describe('Go', () => {
    const CREATED = {
      status: 201,
      body: { id: 5, title: 'Backend Engineer', company: 'Acme', raw_text: 'x'.repeat(150) },
    }

    async function fillRole(user, text = 'x'.repeat(150)) {
      await user.type(screen.getByLabelText('Job title'), 'Backend Engineer')
      await user.type(screen.getByLabelText('Company'), 'Acme')
      await user.type(screen.getByLabelText('Job description'), text)
    }

    const go = () => screen.getByRole('button', { name: /^Go/ })

    it('offers no way to save the role on its own', async () => {
      renderPage()

      expect(screen.queryByRole('button', { name: /Save role/ })).not.toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /^Go/ })).toBeInTheDocument()
    })

    it('saves the posting and lights its cue lamp', async () => {
      stubFetch({ ...EMPTY_LISTS, 'POST /api/job-descriptions/': CREATED })
      const user = userEvent.setup()
      renderPage()

      await fillRole(user)
      await user.click(go())

      expect(await screen.findByText('Backend Engineer · Acme')).toBeInTheDocument()
    })

    it('keeps the typed posting on screen and says what is still missing', async () => {
      const text = 'x'.repeat(150)
      stubFetch({ ...EMPTY_LISTS, 'POST /api/job-descriptions/': CREATED })
      const user = userEvent.setup()
      renderPage()

      await fillRole(user, text)
      await user.click(go())

      // Nowhere to go without a CV, so the posting is kept and the page says so
      // rather than walking to a step that cannot run.
      expect(await screen.findByRole('status')).toHaveTextContent('Add your CV above')
      expect(screen.getByLabelText('Job description')).toHaveValue(text)
      expect(go()).toBeEnabled()
    })

    it('goes to the match for the pair it just saved', async () => {
      stubFetch({
        ...EMPTY_LISTS,
        'GET /api/resumes/': { body: [{ id: 1, filename: 'cv.pdf', parsed_text: PARSED }] },
        'POST /api/job-descriptions/': CREATED,
      })
      onTheBench({ resumeId: 1, roleId: null })
      const user = userEvent.setup()
      const { at } = renderPage()

      await fillRole(user)
      await user.click(go())

      // Both ids named, so the match lands on this application rather than on
      // whichever documents happen to be newest.
      await waitFor(() => expect(at()).toBe('/app/match?resume=1&role=5'))
    })

    it('does not save the same posting twice', async () => {
      const fetchMock = stubFetch({
        ...EMPTY_LISTS,
        'GET /api/resumes/': { body: [{ id: 1, filename: 'cv.pdf', parsed_text: PARSED }] },
        'POST /api/job-descriptions/': CREATED,
      })
      onTheBench({ resumeId: 1, roleId: null })
      const user = userEvent.setup()
      renderPage()

      await fillRole(user)
      await user.click(go())
      await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())

      const posts = () => fetchMock.requests.filter((row) => row.method === 'POST').length
      const before = posts()
      await user.click(go())

      // A JobDescription is append-only. A second identical row would split this
      // application across two history records.
      expect(posts()).toBe(before)
    })
  })

  it('opens the way to the match once both steps are green', async () => {
    stubFetch({
      ...EMPTY_LISTS,
      'GET /api/resumes/': { body: [{ id: 1, filename: 'cv.pdf', parsed_text: PARSED }] },
      'GET /api/job-descriptions/': { body: [{ id: 5, title: 'Backend Engineer', company: '' }] },
    })
    onTheBench({ resumeId: 1, roleId: 5 })
    renderPage()

    // The pair is named, so walking on cannot quietly swap in other documents.
    expect(await screen.findByRole('link', { name: /Analyse the match/ })).toHaveAttribute(
      'href',
      '/app/match?resume=1&role=5'
    )
    expect(screen.getByText('Ready to run')).toBeInTheDocument()
  })

  it('offers no way forward while a step is still dark', async () => {
    renderPage()

    expect(await screen.findByText('No CV uploaded yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Analyse the match/ })).not.toBeInTheDocument()
  })

  it('opens an empty bench rather than resuming the newest documents on file', async () => {
    // Signing in should read like a new application, not like walking back into one
    // finished last week — nothing on this tab's bench means nothing on screen.
    stubFetch({
      ...EMPTY_LISTS,
      'GET /api/resumes/': { body: [{ id: 1, filename: 'cv.pdf', parsed_text: PARSED }] },
      'GET /api/job-descriptions/': { body: [{ id: 5, title: 'Backend Engineer', company: '' }] },
    })
    renderPage()

    expect(await screen.findByText('No CV uploaded yet')).toBeInTheDocument()
    expect(screen.getByText('No job description yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Analyse the match/ })).not.toBeInTheDocument()
  })

  describe('when the session is gone', () => {
    // Signed out, the page can only be reached by a session that died while it was
    // open. Every POST from here is a guaranteed 401, so the page says so itself
    // rather than sending the work off to be rejected.
    function renderSignedOut() {
      return renderWithStore(<UploadResume />, {})
    }

    it('asks the user to sign in instead of posting the role', async () => {
      const fetchMock = stubFetch(EMPTY_LISTS)
      const user = userEvent.setup()
      renderSignedOut()

      await user.type(screen.getByLabelText('Job title'), 'Backend Engineer')
      await user.type(screen.getByLabelText('Job description'), 'x'.repeat(150))
      await user.click(screen.getByRole('button', { name: /^Go/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/signed out.*was not saved/)
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
      expect(fetchMock.lastOf('POST')).toBeUndefined()
    })

    it('keeps the typed role on screen when it asks them to sign in', async () => {
      stubFetch(EMPTY_LISTS)
      const text = 'x'.repeat(150)
      const user = userEvent.setup()
      renderSignedOut()

      await user.type(screen.getByLabelText('Job title'), 'Backend Engineer')
      await user.type(screen.getByLabelText('Job description'), text)
      await user.click(screen.getByRole('button', { name: /^Go/ }))

      await screen.findByRole('alert')
      expect(screen.getByLabelText('Job description')).toHaveValue(text)
    })

    it('asks the user to sign in instead of uploading the CV', async () => {
      const fetchMock = stubFetch(EMPTY_LISTS)
      const user = userEvent.setup()
      renderSignedOut()

      await user.upload(fileInput(), PDF())

      expect(await screen.findByRole('alert')).toHaveTextContent(/signed out.*resume was not saved/)
      expect(fetchMock.lastOf('POST')).toBeUndefined()
    })

    it('restores the role draft so signing in does not cost the posting', async () => {
      // What the candidate typed before the session expired, as the page left it.
      sessionStorage.setItem(
        'greenroom.draft.role',
        JSON.stringify({ title: 'Backend Engineer', company: 'Acme', raw_text: 'y'.repeat(150) })
      )
      stubFetch(EMPTY_LISTS)
      renderPage()

      expect(screen.getByLabelText('Job title')).toHaveValue('Backend Engineer')
      expect(screen.getByLabelText('Job description')).toHaveValue('y'.repeat(150))
      expect(screen.getByRole('button', { name: /^Go/ })).toBeEnabled()
    })
  })

  /**
   * The history rail.
   *
   * The fixtures deliberately put a newer CV and a newer posting on file than the
   * ones the record was run against: that is the case the whole feature exists for,
   * and it is the only way to tell "the record opened" apart from "the page is
   * showing the newest of everything anyway".
   */
  describe('history', () => {
    const OLD_CV = {
      id: 1,
      filename: 'cv-v1.pdf',
      parsed_text: 'Jane Q. Candidate — ran Celery in anger.',
      uploaded_at: '2026-06-01T10:00:00Z',
    }
    const NEW_CV = { id: 2, filename: 'cv-v2.pdf', parsed_text: PARSED, uploaded_at: '2026-07-20T10:00:00Z' }
    const OLD_ROLE = {
      id: 5,
      title: 'Backend Engineer',
      company: 'Acme',
      raw_text: 'You will own the billing pipeline. ' + 'x'.repeat(150),
      created_at: '2026-06-01T10:00:00Z',
    }
    const NEW_ROLE = { id: 6, title: 'Platform Engineer', company: '', raw_text: 'y'.repeat(150) }

    const MATCH = {
      id: 11,
      resume: OLD_CV.id,
      resume_filename: OLD_CV.filename,
      job_description: OLD_ROLE.id,
      job_title: OLD_ROLE.title,
      company: 'Acme',
      status: 'complete',
      match_score: 76,
      reasoning: 'You evidence the Celery work this role leads with.',
      matched_skills: ['Python'],
      missing_skills: ['Kubernetes'],
      error_message: '',
      created_at: '2026-06-02T10:00:00Z',
      completed_at: '2026-06-02T10:00:41Z',
    }

    const sat = (id, at, extra = {}) => ({
      id,
      resume: OLD_CV.id,
      job_description: OLD_ROLE.id,
      status: 'complete',
      question_count: 8,
      answered_count: 8,
      report: null,
      created_at: at,
      ...extra,
    })

    const WITH_HISTORY = {
      ...EMPTY_LISTS,
      'GET /api/resumes/': { body: [NEW_CV, OLD_CV] },
      'GET /api/job-descriptions/': { body: [NEW_ROLE, OLD_ROLE] },
      'GET /api/match-analyses/': { body: [MATCH] },
      'GET /api/interviews/': {
        body: [
          sat(42, '2026-06-10T10:00:00Z', { report: { status: 'complete', overall_score: 74 } }),
          sat(41, '2026-06-03T10:00:00Z'),
        ],
      },
    }

    // The record's own button, told apart from the "working on now" row by the
    // posting it names — which is not the one currently in the form.
    const record = () => screen.getByRole('button', { name: /Backend Engineer/ })

    async function openRecord(user) {
      await user.click(await screen.findByRole('button', { name: /Backend Engineer/ }))
    }

    it('says so plainly when there is nothing to look back at', async () => {
      renderPage()

      expect(await screen.findByText(/Records appear here once you have matched/)).toBeInTheDocument()
    })

    it('lists a record for each pair that has been run against', async () => {
      stubFetch(WITH_HISTORY)
      renderPage()

      // The score and the interview count are on the row, so the rail is scannable
      // without opening anything.
      expect(await screen.findByRole('button', { name: /Backend Engineer/ })).toHaveAccessibleName(
        /76 \/ 100/
      )
      expect(record()).toHaveAccessibleName(/2 interviews/)
      expect(record()).toHaveAccessibleName(/Acme · cv-v1\.pdf/)
    })

    it('opens the CV and the posting that record was run against', async () => {
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)

      // The older documents, not the newer ones sitting at the top of both lists.
      expect(screen.getByText(/ran Celery in anger/)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument()
      expect(screen.getByText(/own the billing pipeline/)).toBeInTheDocument()
      expect(screen.queryByText(new RegExp(PARSED.split('\n')[1]))).not.toBeInTheDocument()
    })

    it('does not offer to edit a saved record', async () => {
      // Both documents are append-only rows. An upload box or an editable form here
      // would imply this record can be changed, and it cannot.
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)

      expect(screen.queryByRole('button', { name: 'Choose a file' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Job description')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Back to the current one' })).toBeInTheDocument()
    })

    it('goes back to the live form', async () => {
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)
      await user.click(screen.getByRole('button', { name: 'Back to the current one' }))

      expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument()
      expect(screen.getByLabelText('Job description')).toBeInTheDocument()
    })

    it('describes the open record in the progress sidebar', async () => {
      // The sidebar is shared by every screen and must not contradict the two
      // documents sitting next to it.
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)

      expect(screen.getByText('Backend Engineer · Acme')).toBeInTheDocument()
      expect(screen.getByText(`cv-v1.pdf · ${OLD_CV.parsed_text.length} chars`)).toBeInTheDocument()
      expect(screen.getByText('76 / 100 · Backend Engineer')).toBeInTheDocument()
    })

    it('lists every interview sat for the pair, each linking to its own session', async () => {
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)
      await user.click(screen.getByRole('button', { name: /Interviews/ }))

      // Numbered from the first one sat, so the labels do not shuffle when another
      // is added.
      expect(screen.getByRole('link', { name: /Interview 1/ })).toHaveAttribute(
        'href',
        '/app/interview?session=41'
      )
      const second = screen.getByRole('link', { name: /Interview 2/ })
      expect(second).toHaveAttribute('href', '/app/interview?session=42')
      expect(second).toHaveAccessibleName(/Debriefed · 74 \/ 100/)
    })

    it('closes the interview dropdown on Escape', async () => {
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)

      const trigger = screen.getByRole('button', { name: /Interviews/ })
      await user.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')

      await user.keyboard('{Escape}')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('link', { name: /Interview 1/ })).not.toBeInTheDocument()
    })

    it('shows the match result the pair was scored at, on request', async () => {
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)

      // Behind a button: the record is opened to read the documents, and a full score
      // card unfurling underneath them uninvited would bury what was clicked for.
      expect(screen.queryByText(/evidence the Celery work/)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Show the match result/ }))

      expect(screen.getByText(/evidence the Celery work/)).toBeInTheDocument()
      expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '76')
      expect(screen.getByRole('link', { name: /Open this on the match page/ })).toHaveAttribute(
        'href',
        '/app/match?analysis=11'
      )
    })

    it('offers a fresh run for a pair that has only been interviewed', async () => {
      // A pair can exist with one kind of run and not the other, and the way to the
      // missing one has to be the pair's own documents rather than today's.
      stubFetch({ ...WITH_HISTORY, 'GET /api/match-analyses/': { body: [] } })
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)

      expect(screen.getByRole('link', { name: /Run a match for this pair/ })).toHaveAttribute(
        'href',
        '/app/match?resume=1&role=5'
      )
    })

    it('offers a fresh interview for a pair that has only been matched', async () => {
      stubFetch({ ...WITH_HISTORY, 'GET /api/interviews/': { body: [] } })
      const user = userEvent.setup()
      renderPage()
      await openRecord(user)

      expect(screen.getByRole('link', { name: /Sit an interview for this pair/ })).toHaveAttribute(
        'href',
        '/app/interview?resume=1&role=5'
      )
    })

    it('names the open record in the URL so a later step can come back to it', async () => {
      // Without this, walking to the match page and back would drop the record and
      // the next run would land on whatever the bench holds — a second history
      // section for one application.
      stubFetch(WITH_HISTORY)
      const user = userEvent.setup()
      const { at } = renderPage()
      await openRecord(user)

      expect(at()).toBe('/app?resume=1&role=5')
    })

    it('re-opens the record a later step sent it back to', async () => {
      stubFetch(WITH_HISTORY)
      renderPage({ route: '/app?resume=1&role=5' })

      expect(await screen.findByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument()
      expect(screen.queryByLabelText('Job description')).not.toBeInTheDocument()
    })

    it('opens the bench pair once something has been run against it', async () => {
      // The bench and the record are the same application by then. Showing an empty
      // form beside it would invite a second one.
      stubFetch(WITH_HISTORY)
      onTheBench({ resumeId: OLD_CV.id, roleId: OLD_ROLE.id })
      renderPage()

      expect(await screen.findByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /New application/ })).toBeInTheDocument()
      expect(screen.queryByText('Working on now')).not.toBeInTheDocument()
    })

    it('clears the bench for a new application', async () => {
      stubFetch(WITH_HISTORY)
      onTheBench({ resumeId: OLD_CV.id, roleId: OLD_ROLE.id })
      sessionStorage.setItem(
        'greenroom.draft.role',
        JSON.stringify({ title: 'Backend Engineer', company: 'Acme', raw_text: 'z'.repeat(150) })
      )
      const user = userEvent.setup()
      renderPage()

      await user.click(await screen.findByRole('button', { name: /New application/ }))

      expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument()
      expect(screen.getByLabelText('Job description')).toHaveValue('')
      expect(screen.getByText('No CV uploaded yet')).toBeInTheDocument()
      // The record itself is untouched — only the bench was cleared.
      expect(screen.getByRole('button', { name: /Backend Engineer/ })).toBeInTheDocument()
    })
  })

  it('reports that every upload is kept when several CVs exist', async () => {
    stubFetch({
      ...EMPTY_LISTS,
      'GET /api/resumes/': {
        body: [
          { id: 2, filename: 'cv-v2.pdf', parsed_text: PARSED },
          { id: 1, filename: 'cv-v1.pdf', parsed_text: PARSED },
        ],
      },
    })
    renderPage()

    expect(await screen.findByText(/2 CVs on file/)).toBeInTheDocument()
  })
})
