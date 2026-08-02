/**
 * Turn an RTK Query error into something a person can act on.
 *
 * DRF reports validation failures as {field: [msg]}, auth failures as
 * {detail: msg}, and network failures as no body at all. Flattening that here
 * means no page has to render "Something went wrong".
 */
export function errorMessage(error, fallback = 'That did not work. Please try again.') {
  if (!error) return null

  if (error.status === 'FETCH_ERROR') {
    return 'Could not reach the server. Check that the Django dev server is running on port 8000.'
  }

  const data = error.data
  if (!data) return fallback
  if (typeof data === 'string') return data
  if (data.detail) return data.detail

  const messages = Object.entries(data).flatMap(([field, value]) => {
    const parts = Array.isArray(value) ? value : [value]
    // Non-field errors read better without a "non_field_errors:" prefix.
    const prefix = field === 'non_field_errors' || field === 'detail' ? '' : ''
    return parts.map((part) => `${prefix}${part}`)
  })

  return messages.length ? messages.join(' ') : fallback
}

/** Per-field errors, for inline display next to the input that caused them. */
export function fieldErrors(error) {
  const data = error?.data
  if (!data || typeof data !== 'object') return {}

  return Object.fromEntries(
    Object.entries(data)
      .filter(([field]) => field !== 'detail' && field !== 'non_field_errors')
      .map(([field, value]) => [field, Array.isArray(value) ? value.join(' ') : String(value)])
  )
}
