import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import Field from '../components/Field'
import Notice from '../components/Notice'
import { errorMessage, fieldErrors } from '../lib/errors'
import { useRegisterMutation } from '../store/api/authApi'
import AuthStage from './AuthStage'

export default function CreateAccount() {
  const navigate = useNavigate()
  const [register, { isLoading, error }] = useRegisterMutation()
  const [form, setForm] = useState({ username: '', email: '', password: '', phone: '' })

  const invalid = fieldErrors(error)
  const generalError = error && !Object.keys(invalid).length ? errorMessage(error) : null

  async function handleSubmit(event) {
    event.preventDefault()
    try {
      await register(form).unwrap()
      // Register returns tokens, so there is no second sign-in step.
      navigate('/app', { replace: true })
    } catch {
      // Rendered from `error` below.
    }
  }

  return (
    <AuthStage
      headline={['Bring', 'your', 'resume.']}
      lede="One account holds every resume you upload, every role you target, and every rehearsal you run — so you can watch your scores move."
    >
      <h2 className="font-display text-xl font-bold tracking-[-0.02em]">Create an account</h2>

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
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          error={invalid.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, and not a common password."
          value={form.password}
          error={invalid.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          required
        />

        <Notice>{generalError}</Notice>

        <button type="submit" disabled={isLoading} className="btn-ink w-full">
          {isLoading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate">
        Already have one?{' '}
        <Link to="/sign-in" className="font-medium text-azure underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthStage>
  )
}
