import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

import SignIn from './SignIn'
import { renderWithStore } from '../test/renderWithStore'
import { stubFetch } from '../test/stubFetch'

const TOKENS = { access: 'access-token', refresh: 'refresh-token' }

const OK = { 'POST /api/auth/login/': { body: TOKENS } }

/**
 * Rendered inside a route tree rather than bare, because half of what SignIn does
 * on success is navigate — asserting on the landed-on page is the only way to
 * catch a redirect that silently stops working.
 */
function renderPage({ route = '/sign-in' } = {}) {
  return renderWithStore(
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/app" element={<h1>Upload a CV</h1>} />
      <Route path="/app/history" element={<h1>History</h1>} />
    </Routes>,
    { route }
  )
}

async function signIn(user, { username = 'jane', password = 's3cret-passphrase' } = {}) {
  await user.type(screen.getByLabelText('Username'), username)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SignIn', () => {
  it('signs in and lands on the app', async () => {
    stubFetch(OK)
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    expect(await screen.findByRole('heading', { name: 'Upload a CV' })).toBeInTheDocument()
  })

  it('keeps the token pair so the next request is authenticated', async () => {
    stubFetch(OK)
    const user = userEvent.setup()
    const { store } = renderPage()

    await signIn(user)

    await waitFor(() => expect(store.getState().auth.token).toBe('access-token'))
    // The refresh token matters as much as the access one: without it the 401
    // retry in apiSlice has nothing to re-up with and the session dies early.
    expect(store.getState().auth.refresh).toBe('refresh-token')
  })

  it('survives a reload by persisting the session', async () => {
    stubFetch(OK)
    const user = userEvent.setup()
    renderPage()

    await signIn(user)
    await waitFor(() => expect(localStorage.getItem('greenroom.auth')).toBeTruthy())

    // Asserted by reloading rather than by reading the stored blob. authSlice reads
    // localStorage once, at module load, so re-importing it *is* the reload — and it
    // is the only thing that proves what was written can be read back. Asserting on
    // the blob's keys would only check that the slice agrees with itself, which it
    // always does: it writes `token` and the login response carries `access`, so a
    // test comparing the two shapes fails while the session works perfectly.
    vi.resetModules()
    const { default: authReducer, selectIsAuthenticated } = await import('../store/authSlice')
    const rehydrated = authReducer(undefined, { type: '@@INIT' })

    expect(selectIsAuthenticated({ auth: rehydrated })).toBe(true)
    expect(rehydrated.token).toBe('access-token')
    // Without this the 401 retry in apiSlice has nothing to re-up with, and the
    // reloaded session dies at the first expiry instead of lasting the week.
    expect(rehydrated.refresh).toBe('refresh-token')
  })

  it('comes up signed out when nothing was persisted', async () => {
    // The other half of the same mechanism: a first visit, and the logged-out state
    // after loggedOut() removes the key, must not rehydrate into a phantom session.
    vi.resetModules()
    const { default: authReducer, selectIsAuthenticated } = await import('../store/authSlice')
    const fresh = authReducer(undefined, { type: '@@INIT' })

    expect(selectIsAuthenticated({ auth: fresh })).toBe(false)
    expect(fresh.token).toBeNull()
  })

  it('posts the credentials as JSON', async () => {
    const fetchMock = stubFetch(OK)
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    await waitFor(() => expect(fetchMock.lastOf('POST')).toBeDefined())
    const post = fetchMock.lastOf('POST')

    expect(post.headers.get('Content-Type')).toMatch(/^application\/json/)
    await expect(post.json()).resolves.toEqual({
      username: 'jane',
      password: 's3cret-passphrase',
    })
  })

  it('returns to the page that sent them to sign in', async () => {
    stubFetch(OK)
    const user = userEvent.setup()
    // What RequireAuth stashes when it intercepts a deep link.
    renderPage({ route: { pathname: '/sign-in', state: { from: { pathname: '/app/history' } } } })

    await signIn(user)

    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument()
  })

  it('explains an expired session rather than showing a bare form', async () => {
    stubFetch(OK)
    // What RequireAuth stashes when a session dies while the app is open.
    renderPage({
      route: {
        pathname: '/sign-in',
        state: { reason: 'Your session ended, so nothing was saved.' },
      },
    })

    expect(await screen.findByRole('status')).toHaveTextContent('Your session ended')
  })

  it('shows no explanation to someone who just came to sign in', () => {
    stubFetch(OK)
    renderPage()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('falls back to /app when they came to sign in directly', async () => {
    stubFetch(OK)
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    expect(await screen.findByRole('heading', { name: 'Upload a CV' })).toBeInTheDocument()
  })

  it('reports a wrong password without signing them in', async () => {
    stubFetch({
      'POST /api/auth/login/': {
        status: 401,
        body: { detail: 'No active account found with the given credentials' },
      },
    })
    const user = userEvent.setup()
    const { store } = renderPage()

    await signIn(user, { password: 'wrong' })

    expect(await screen.findByRole('alert')).toHaveTextContent('No active account found')
    expect(store.getState().auth.token).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a CV' })).not.toBeInTheDocument()
  })

  it('names the unreachable server instead of blaming the password', async () => {
    // Regression test for the ::1-vs-127.0.0.1 mix-up: a refused connection has no
    // response body, and reading it as a failed login sends people off to reset a
    // password that was never wrong.
    stubFetch({})
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/)
  })

  it('shows a missing-field complaint next to the field', async () => {
    stubFetch({
      'POST /api/auth/login/': {
        status: 400,
        body: { password: ['This field may not be blank.'] },
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Username'), 'jane')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const password = screen.getByLabelText('Password')
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'))
    expect(password).toHaveAccessibleDescription('This field may not be blank.')
    // A field-level problem is already shown in place; repeating it in the banner
    // reads as two separate failures.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('blocks a second submit while the first is in flight', async () => {
    let release
    stubFetch({
      'POST /api/auth/login/': async () => {
        await new Promise((resolve) => {
          release = resolve
        })
        return { body: TOKENS }
      },
    })
    const user = userEvent.setup()
    renderPage()

    await signIn(user)

    const button = await screen.findByRole('button', { name: 'Signing in…' })
    expect(button).toBeDisabled()

    release()
    expect(await screen.findByRole('heading', { name: 'Upload a CV' })).toBeInTheDocument()
  })

  it('offers a way to the sign-up page', async () => {
    stubFetch(OK)
    renderPage()

    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/create-account'
    )
  })

  it('lets password managers fill it', () => {
    stubFetch(OK)
    renderPage()

    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
})
