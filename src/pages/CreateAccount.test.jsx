import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

import CreateAccount from './CreateAccount'
import { renderWithStore } from '../test/renderWithStore'
import { stubFetch } from '../test/stubFetch'

const CANDIDATE = {
  id: 1,
  username: 'jane',
  email: 'jane@example.com',
  phone: '',
  created_at: '2026-07-27T10:00:00Z',
}

const CREATED = {
  'POST /api/auth/register/': {
    status: 201,
    body: { candidate: CANDIDATE, access: 'access-token', refresh: 'refresh-token' },
  },
}

function renderPage() {
  return renderWithStore(
    <Routes>
      <Route path="/create-account" element={<CreateAccount />} />
      <Route path="/app" element={<h1>Upload a CV</h1>} />
    </Routes>,
    { route: '/create-account' }
  )
}

async function fillIn(user, overrides = {}) {
  const values = {
    Username: 'jane',
    Email: 'jane@example.com',
    Password: 's3cret-passphrase',
    ...overrides,
  }

  for (const [label, value] of Object.entries(values)) {
    if (value) await user.type(screen.getByLabelText(label), value)
  }
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CreateAccount', () => {
  it('creates the account and lands signed in', async () => {
    stubFetch(CREATED)
    const user = userEvent.setup()

    const { store } = renderPage()
    await fillIn(user)

    expect(await screen.findByRole('heading', { name: 'Upload a CV' })).toBeInTheDocument()
    expect(store.getState().auth.token).toBe('access-token')
  })

  it('does not make them sign in again straight after signing up', async () => {
    // Register returns a token pair precisely so this second round trip never
    // happens; a login call here means that contract has been broken.
    const fetchMock = stubFetch(CREATED)
    const user = userEvent.setup()

    renderPage()
    await fillIn(user)

    await screen.findByRole('heading', { name: 'Upload a CV' })
    expect(fetchMock.requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/api/auth/register/',
    ])
  })

  it('keeps the new candidate so the header can greet them', async () => {
    stubFetch(CREATED)
    const user = userEvent.setup()

    const { store } = renderPage()
    await fillIn(user)

    await waitFor(() => expect(store.getState().auth.candidate).toEqual(CANDIDATE))
  })

  it('posts the details it collected', async () => {
    const fetchMock = stubFetch(CREATED)
    const user = userEvent.setup()

    renderPage()
    await fillIn(user)

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    await expect(fetchMock.lastOf('POST').json()).resolves.toMatchObject({
      username: 'jane',
      email: 'jane@example.com',
      password: 's3cret-passphrase',
    })
  })

  it('lets them sign up without an email', async () => {
    stubFetch(CREATED)
    const user = userEvent.setup()

    renderPage()

    // The serializer treats email as optional, so the form must not require it.
    expect(screen.getByLabelText('Email')).not.toBeRequired()

    await fillIn(user, { Email: '' })
    expect(await screen.findByRole('heading', { name: 'Upload a CV' })).toBeInTheDocument()
  })

  it('points a taken username at the username box', async () => {
    stubFetch({
      'POST /api/auth/register/': {
        status: 400,
        body: { username: ['That username is already taken.'] },
      },
    })
    const user = userEvent.setup()

    const { store } = renderPage()
    await fillIn(user)

    const username = screen.getByLabelText('Username')
    await waitFor(() => expect(username).toHaveAttribute('aria-invalid', 'true'))
    expect(username).toHaveAccessibleDescription('That username is already taken.')
    expect(store.getState().auth.token).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a CV' })).not.toBeInTheDocument()
  })

  it('replaces the password hint with the rule that was broken', async () => {
    stubFetch({
      'POST /api/auth/register/': {
        status: 400,
        body: { password: ['This password is too short. It must contain at least 8 characters.'] },
      },
    })
    const user = userEvent.setup()

    renderPage()
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 8 characters, and not a common password.'
    )

    await fillIn(user, { Password: '123' })

    // Django can return several password complaints at once; all of them belong on
    // the field, and the generic hint would only compete with them.
    const password = screen.getByLabelText('Password')
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'))
    expect(password).toHaveAccessibleDescription(/at least 8 characters/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows more than one password complaint', async () => {
    stubFetch({
      'POST /api/auth/register/': {
        status: 400,
        body: {
          password: ['This password is too short.', 'This password is too common.'],
        },
      },
    })
    const user = userEvent.setup()

    renderPage()
    await fillIn(user, { Password: 'password' })

    const password = screen.getByLabelText('Password')
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'))
    expect(password).toHaveAccessibleDescription(/too short.*too common/i)
  })

  it('names the unreachable server rather than failing silently', async () => {
    stubFetch({})
    const user = userEvent.setup()

    renderPage()
    await fillIn(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/)
  })

  it('blocks a second submit while the first is in flight', async () => {
    let release
    stubFetch({
      'POST /api/auth/register/': async () => {
        await new Promise((resolve) => {
          release = resolve
        })
        return { status: 201, body: { candidate: CANDIDATE, access: 'access-token', refresh: 'r' } }
      },
    })
    const user = userEvent.setup()

    renderPage()
    await fillIn(user)

    // Two accounts from one impatient double-click is the failure being prevented.
    const button = await screen.findByRole('button', { name: 'Creating account…' })
    expect(button).toBeDisabled()

    release()
    expect(await screen.findByRole('heading', { name: 'Upload a CV' })).toBeInTheDocument()
  })

  it('offers a way back to signing in', () => {
    stubFetch(CREATED)
    renderPage()

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
  })

  it('asks password managers to store a new password, not fill the old one', () => {
    stubFetch(CREATED)
    renderPage()

    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
})
