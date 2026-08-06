/**
 * The candidate's history, derived from rows the app already holds.
 *
 * A record here is one resume paired with one job description. That pairing is not
 * a table: Resume and JobDescription are independent append-only rows, and what
 * joins them is having been run against each other — a MatchAnalysis or an
 * InterviewSession naming both. So the pairs are read off those two lists and the
 * documents are looked up by id from the other two.
 *
 * Nothing here fetches. All four lists are already on the page for the progress
 * sidebar, so history costs no extra request and no new endpoint.
 */

const time = (iso) => {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * How a record is named. One place, because the pages compare the pair they are
 * working on against these keys to decide whether it has become a record yet.
 *
 * Null until both halves exist: a CV with no posting is not an application.
 */
export function pairKey(resumeId, roleId) {
  return resumeId && roleId ? `${resumeId}:${roleId}` : null
}

export function buildHistory({ resumes = [], roles = [], analyses = [], sessions = [] }) {
  const byKey = new Map()

  // Rows can name a document that is not in the lists we were given — a partial
  // fetch, or a resume deleted from the admin. The pair is still real and its runs
  // are still readable, so it is kept with a null document rather than dropped.
  const pair = (resumeId, roleId) => {
    const key = pairKey(resumeId, roleId)
    let entry = byKey.get(key)
    if (!entry) {
      entry = {
        key,
        resumeId,
        roleId,
        resume: resumes.find((row) => row.id === resumeId) ?? null,
        role: roles.find((row) => row.id === roleId) ?? null,
        analyses: [],
        sessions: [],
      }
      byKey.set(key, entry)
    }
    return entry
  }

  for (const analysis of analyses) {
    pair(analysis.resume, analysis.job_description).analyses.push(analysis)
  }
  for (const session of sessions) {
    pair(session.resume, session.job_description).sessions.push(session)
  }

  return [...byKey.values()].map(summarise).sort((a, b) => b.activeAt - a.activeAt)
}

function summarise(entry) {
  // Ascending, so "Interview 1" is the first one ever sat for this pair and keeps
  // that number when another is added — a label that renumbers itself is not a
  // label. Tie-broken on id because ids are monotonic and created_at can be equal
  // (two inserts in the same tick) or absent.
  const sessions = [...entry.sessions]
    .sort((a, b) => time(a.created_at) - time(b.created_at) || a.id - b.id)
    .map((session, index) => ({ ...session, number: index + 1 }))

  const analyses = [...entry.analyses].sort(
    (a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id
  )

  return {
    ...entry,
    sessions,
    analyses,
    /**
     * The result worth offering: the newest run that produced a score. A pending or
     * failed row is offered when it is all there is, because "the match you asked
     * for stopped" is something the candidate needs to be able to read.
     */
    match: analyses.find((row) => row.status === 'complete') ?? analyses[0] ?? null,
    latestSession: sessions.at(-1) ?? null,
    activeAt: [...analyses, ...sessions].reduce(
      (newest, row) => Math.max(newest, time(row.created_at)),
      0
    ),
  }
}

/** One line describing how far an interview got. Mirrors the wording in lib/cues.js. */
export function sessionSummary(session) {
  if (session.status === 'pending') return 'Writing questions…'
  if (session.status === 'failed') return 'Stopped before any questions'
  if (session.report?.status === 'complete') {
    return `Debriefed · ${session.report.overall_score} / 100`
  }

  const { answered_count: answered = 0, question_count: total = 0 } = session
  return `${answered} of ${total} answered`
}

/**
 * A date, or '' — history rows carry timestamps that fixtures and old rows may not.
 *
 * Takes an ISO string or the epoch milliseconds an entry's ``activeAt`` already holds.
 */
export function whenLabel(value) {
  const ms = typeof value === 'number' ? value : time(value)
  return ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''
}
