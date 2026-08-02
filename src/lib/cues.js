/**
 * The progress sidebar, built from real rows.
 *
 * Shared by every page in the app so the readout cannot disagree with itself
 * depending on which screen you are standing on. Each cue maps to one table:
 * Resume, JobDescription, MatchAnalysis, InterviewSession.
 *
 * 'ready' means the row exists, 'live' means something is working on it, 'dark'
 * means it is not there yet — see CueLamp.
 */
export function buildCues({
  resume,
  role,
  match,
  session,
  uploading = false,
  savingRole = false,
}) {
  return [
    {
      id: 'cv',
      label: 'Resume read',
      state: resume ? 'ready' : uploading ? 'live' : 'dark',
      detail: resume
        ? `${resume.filename} · ${resume.parsed_text.length.toLocaleString()} chars`
        : 'No CV uploaded yet',
    },
    {
      id: 'role',
      label: 'Role set',
      state: role ? 'ready' : savingRole ? 'live' : 'dark',
      detail: role ? [role.title, role.company].filter(Boolean).join(' · ') : 'No job description yet',
    },
    {
      id: 'match',
      label: 'Match analysed',
      state: matchState(match),
      detail: matchDetail(match, Boolean(resume && role)),
    },
    {
      id: 'rehearsal',
      label: 'Interview run',
      state: rehearsalState(session),
      detail: rehearsalDetail(session, Boolean(resume && role)),
    },
  ]
}

function matchState(match) {
  if (match?.status === 'complete') return 'ready'
  if (match?.status === 'pending') return 'live'
  return 'dark'
}

function matchDetail(match, ready) {
  if (match?.status === 'complete') return `${match.match_score} / 100 · ${match.job_title}`
  if (match?.status === 'pending') return 'The agent is reading…'
  if (match?.status === 'failed') return 'Last run failed'
  return ready ? 'Ready to run' : 'Needs a CV and a role'
}

/**
 * The interview cue is 'ready' only once the debrief exists.
 *
 * A session with questions is not a finished rehearsal — the candidate has not
 * learned anything until their answers have been read. So 'live' covers the whole
 * span from "writing questions" through "half way through answering", and green is
 * reserved for the end of it.
 */
function rehearsalState(session) {
  if (!session) return 'dark'
  if (session.status === 'failed') return 'dark'
  if (session.report?.status === 'complete') return 'ready'
  return 'live'
}

function rehearsalDetail(session, ready) {
  if (!session) return ready ? 'Ready to sit' : 'Needs a CV and a role'
  if (session.status === 'pending') return 'Writing your questions…'
  if (session.status === 'failed') return 'Last run failed'

  const { answered_count: answered = 0, question_count: total = 0 } = session
  if (session.report?.status === 'complete') {
    return `Debriefed · ${session.report.overall_score} / 100`
  }
  if (session.report?.status === 'pending') return 'Writing your debrief…'

  return `${answered} of ${total} answered`
}
