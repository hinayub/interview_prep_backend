import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  // authSlice persists to localStorage; leaking it between tests would leave a
  // stale token in place and mask auth bugs. Form drafts live in sessionStorage
  // and would likewise arrive pre-filled in the next test.
  localStorage.clear()
  sessionStorage.clear()
})
