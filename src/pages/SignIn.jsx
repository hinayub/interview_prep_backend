import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import Field from '../components/Field'
import Notice from '../components/Notice'
import { errorMessage, fieldErrors } from '../lib/errors'
import { useLoginMutation } from '../store/api/authApi'
import AuthStage from './AuthStage'

export default function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const [login, { isLoading, error }] = useLoginMutation()
  const [form, setForm] = useState({ username: '', password: '' })

  const invalid = fieldErrors(error)

  async function handleSubmit(event) {
    event.preventDefault()
    try {
      await login(form).unwrap()
      navigate(location.state?.from?.pathname ?? '/app', { replace: true })
    } catch {
      // Rendered from `error` below.
    }
  }

  return (
    <AuthStage
      headline={['Nobody', 'walks in', 'cold.']}
      lede="Practice the interview before it happens. Your resume and the role go in; the questions, the answers and the score come back out."
    >
      <h2 className="font-display text-xl font-bold tracking-[-0.02em]">Sign in</h2>

      {location.state?.reason && (
        <div className="mt-4">
          <Notice tone="note">{location.state.reason}</Notice>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
        <Field
          id="username"
          label="Username"
          autoComplete="username"
          value={form.username}
          error={invalid.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          required
        />

        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          error={invalid.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          required
        />

        <Notice>{error && !Object.keys(invalid).length ? errorMessage(error, 'That username and password do not match.') : null}</Notice>

        <button type="submit" disabled={isLoading} className="btn-lamp w-full">
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-sm text-dusk">
        First time here?{' '}
        <Link to="/create-account" className="font-medium text-sodium underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthStage>
  )
}
