/**
 * The URL contract for opening a past run.
 *
 * Steps 2 and 3 default to the newest documents on file, which is right for
 * someone walking the funnel and wrong for someone who just clicked a record in
 * their history. These params are how history says which pair — and, when the run
 * already happened, which row — the page should show:
 *
 *   /app?resume=7&role=3           step 1 with that record open
 *   /app/match?analysis=11         that analysis, and the documents it scored
 *   /app/match?resume=7&role=3     a fresh run for that pair
 *   /app/interview?session=42      that interview
 *   /app/interview?resume=7&role=3 a fresh interview for that pair
 *
 * Every link between the three steps carries its pair, so walking the funnel keeps
 * adding to one record instead of starting a new one at each hop.
 *
 * Written and read in one file so the two ends cannot drift.
 */

const id = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Read the target out of a page's search params.
 *
 * ``rowParam`` is 'analysis' on the match page and 'session' on the interview one.
 * Step 1 names no row and omits it. Everything is null when nothing was asked for,
 * which is what puts a page back on its default.
 */
export function readTarget(searchParams, rowParam) {
  return {
    rowId: rowParam ? id(searchParams.get(rowParam)) : null,
    resumeId: id(searchParams.get('resume')),
    roleId: id(searchParams.get('role')),
  }
}

/** Step 1, with a record open when both ids are given. */
export function uploadLink({ resumeId, roleId } = {}) {
  if (!resumeId || !roleId) return '/app'
  return `/app?resume=${resumeId}&role=${roleId}`
}

export function matchLink({ analysisId, resumeId, roleId } = {}) {
  if (analysisId) return `/app/match?analysis=${analysisId}`
  return `/app/match?resume=${resumeId}&role=${roleId}`
}

export function interviewLink({ sessionId, resumeId, roleId } = {}) {
  if (sessionId) return `/app/interview?session=${sessionId}`
  return `/app/interview?resume=${resumeId}&role=${roleId}`
}
