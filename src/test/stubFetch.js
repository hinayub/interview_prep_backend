import { vi } from 'vitest'

/**
 * Stubs global fetch with a route table keyed by "METHOD /path".
 *
 * Note fetchBaseQuery calls fetch with a single Request object and no init, so the
 * method, headers and body all have to be read off the Request — reading them from
 * a second `init` argument silently makes every call look like a GET.
 *
 * Captured requests are exposed as `.requests` (clones, so the body is still
 * readable in assertions).
 */
export function stubFetch(routes) {
  const requests = []

  const fn = vi.fn(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push(request.clone())

    const key = `${request.method} ${new URL(request.url).pathname}`
    const match = routes[key]
    if (!match) throw new Error(`Unstubbed request: ${key}`)

    const { status = 200, body } = typeof match === 'function' ? await match(request) : match
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  fn.requests = requests
  fn.lastOf = (method) => requests.filter((r) => r.method === method).at(-1)

  vi.stubGlobal('fetch', fn)
  return fn
}
