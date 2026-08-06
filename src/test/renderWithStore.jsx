import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { makeStore } from '../store/store'

/**
 * Renders with a fresh store per test, so RTK Query's cache never bleeds between
 * cases. Pass `auth` to start signed in.
 *
 * `at()` reads back the URL the app has navigated to, path and query together —
 * which is the whole assertion when a button's job is to carry a pair of ids on to
 * the next step.
 */
export function renderWithStore(ui, { auth, route = '/' } = {}) {
  const store = makeStore(
    auth ? { auth: { token: 'test-token', refresh: 'test-refresh', candidate: null, ...auth } } : undefined
  )

  let here = route

  function Probe() {
    const location = useLocation()
    here = location.pathname + location.search
    return null
  }

  return {
    store,
    at: () => here,
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>
          {ui}
          <Probe />
        </MemoryRouter>
      </Provider>
    ),
  }
}
