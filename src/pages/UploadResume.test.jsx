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
}

const PDF = () => new File(['%PDF-1.4 fake'], 'cv.pdf', { type: 'application/pdf' })

function renderPage() {
  return renderWithStore(<UploadResume />, { auth: {} })
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

    expect(screen.getByRole('button', { name: 'Save role' })).toBeDisabled()
    expect(screen.getByText(/Paste more of the posting/)).toBeInTheDocument()
  })

  it('saves a role and lights its cue lamp', async () => {
    stubFetch({
      ...EMPTY_LISTS,
      'POST /api/job-descriptions/': {
        status: 201,
        body: { id: 5, title: 'Backend Engineer', company: 'Acme', raw_text: 'x'.repeat(150) },
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Job title'), 'Backend Engineer')
    await user.type(screen.getByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('Job description'), 'x'.repeat(150))
    await user.click(screen.getByRole('button', { name: 'Save role' }))

    expect(await screen.findByText('Backend Engineer · Acme')).toBeInTheDocument()
  })

  it('keeps the typed role on screen after saving and confirms it', async () => {
    const text = 'x'.repeat(150)
    stubFetch({
      ...EMPTY_LISTS,
      'POST /api/job-descriptions/': {
        status: 201,
        body: { id: 5, title: 'Backend Engineer', company: 'Acme', raw_text: text },
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Job title'), 'Backend Engineer')
    await user.type(screen.getByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('Job description'), text)
    await user.click(screen.getByRole('button', { name: 'Save role' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Role saved')
    expect(screen.getByLabelText('Job description')).toHaveValue(text)
    expect(screen.getByLabelText('Job title')).toHaveValue('Backend Engineer')
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()

    // Editing re-arms the button: a changed role is a new version to save.
    await user.type(screen.getByLabelText('Job description'), ' more')
    expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled()
  })

  it('opens the way to the match once both steps are green', async () => {
    stubFetch({
      ...EMPTY_LISTS,
      'GET /api/resumes/': { body: [{ id: 1, filename: 'cv.pdf', parsed_text: PARSED }] },
      'GET /api/job-descriptions/': { body: [{ id: 5, title: 'Backend Engineer', company: '' }] },
    })
    renderPage()

    expect(await screen.findByRole('link', { name: /Analyse the match/ })).toHaveAttribute(
      'href',
      '/app/match'
    )
    expect(screen.getByText('Ready to run')).toBeInTheDocument()
  })

  it('offers no way forward while a step is still dark', async () => {
    renderPage()

    expect(await screen.findByText('No CV uploaded yet')).toBeInTheDocument()
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
      await user.click(screen.getByRole('button', { name: 'Save role' }))

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
      await user.click(screen.getByRole('button', { name: 'Save role' }))

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
      expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled()
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
