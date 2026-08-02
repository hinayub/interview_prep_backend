import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'

import { makeStore } from '../store/store'

/**
 * Renders with a fresh store per test, so RTK Query's cache never bleeds between
 * cases. Pass `auth` to start signed in.
 */
export function renderWithStore(ui, { auth, route = '/' } = {}) {
  const store = makeStore(
    auth ? { auth: { token: 'test-token', refresh: 'test-refresh', candidate: null, ...auth } } : undefined
  )

  return {
    store,
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </Provider>
    ),
  }
}
