import { describe, expect, it } from 'vitest'

import { buildHistory, sessionSummary } from './history'

const CV_OLD = { id: 1, filename: 'cv-v1.pdf', parsed_text: 'Django.', uploaded_at: '2026-06-01T10:00:00Z' }
const CV_NEW = { id: 2, filename: 'cv-v2.pdf', parsed_text: 'Django, Redis.', uploaded_at: '2026-07-01T10:00:00Z' }
const ROLE_A = { id: 5, title: 'Backend Engineer', company: 'Acme', raw_text: 'x'.repeat(150) }
const ROLE_B = { id: 6, title: 'Platform Engineer', company: '', raw_text: 'y'.repeat(150) }

const LISTS = { resumes: [CV_NEW, CV_OLD], roles: [ROLE_B, ROLE_A] }

const analysis = (id, resume, role, extra = {}) => ({
  id,
  resume,
  job_description: role,
  status: 'complete',
  match_score: 70,
  created_at: '2026-07-01T10:00:00Z',
  ...extra,
})

const session = (id, resume, role, extra = {}) => ({
  id,
  resume,
  job_description: role,
  status: 'complete',
  question_count: 8,
  answered_count: 8,
  report: null,
  created_at: '2026-07-01T10:00:00Z',
  ...extra,
})

describe('buildHistory', () => {
  it('is empty when nothing has been run', () => {
    // Two documents on file are not a record. What pairs them is a run against both,
    // and until one exists there is nothing to look back at.
    expect(buildHistory(LISTS)).toEqual([])
  })

  it('makes one record per pair and attaches both kinds of run to it', () => {
    const history = buildHistory({
      ...LISTS,
      analyses: [analysis(11, CV_OLD.id, ROLE_A.id)],
      sessions: [session(41, CV_OLD.id, ROLE_A.id)],
    })

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ resumeId: CV_OLD.id, roleId: ROLE_A.id })
    expect(history[0].resume.filename).toBe('cv-v1.pdf')
    expect(history[0].role.title).toBe('Backend Engineer')
    expect(history[0].analyses).toHaveLength(1)
    expect(history[0].sessions).toHaveLength(1)
  })

  it('separates the same posting run against two different CVs', () => {
    // The product's whole claim is "edit your CV, watch the score move", so a new
    // upload against the same posting has to be its own record rather than folded in.
    const history = buildHistory({
      ...LISTS,
      analyses: [analysis(12, CV_NEW.id, ROLE_A.id), analysis(11, CV_OLD.id, ROLE_A.id)],
    })

    expect(history).toHaveLength(2)
    expect(history.map((entry) => entry.resumeId).sort()).toEqual([CV_OLD.id, CV_NEW.id])
  })

  it('numbers interviews from the oldest, so an extra one renumbers nothing', () => {
    const history = buildHistory({
      ...LISTS,
      // Newest first, the order the API returns.
      sessions: [
        session(43, CV_OLD.id, ROLE_A.id, { created_at: '2026-07-20T10:00:00Z' }),
        session(42, CV_OLD.id, ROLE_A.id, { created_at: '2026-07-10T10:00:00Z' }),
        session(41, CV_OLD.id, ROLE_A.id, { created_at: '2026-07-01T10:00:00Z' }),
      ],
    })

    expect(history[0].sessions.map((row) => [row.number, row.id])).toEqual([
      [1, 41],
      [2, 42],
      [3, 43],
    ])
  })

  it('numbers by id when the timestamps tie', () => {
    // Two inserts in the same tick. An arbitrary but stable order beats a label that
    // moves between renders.
    const history = buildHistory({
      ...LISTS,
      sessions: [session(42, CV_OLD.id, ROLE_A.id), session(41, CV_OLD.id, ROLE_A.id)],
    })

    expect(history[0].sessions.map((row) => row.number)).toEqual([1, 2])
    expect(history[0].sessions.map((row) => row.id)).toEqual([41, 42])
  })

  it('offers the newest scored analysis as the record match', () => {
    const history = buildHistory({
      ...LISTS,
      analyses: [
        analysis(13, CV_OLD.id, ROLE_A.id, { status: 'pending', match_score: null, created_at: '2026-07-30T10:00:00Z' }),
        analysis(12, CV_OLD.id, ROLE_A.id, { match_score: 81, created_at: '2026-07-20T10:00:00Z' }),
        analysis(11, CV_OLD.id, ROLE_A.id, { match_score: 62, created_at: '2026-07-01T10:00:00Z' }),
      ],
    })

    // Not the newest row — the newest row that actually produced a score.
    expect(history[0].match.match_score).toBe(81)
  })

  it('still offers a failed analysis when it is the only one', () => {
    // "The match you asked for stopped" is something the candidate has to be able to
    // read; hiding the row would leave the record looking like it was never run.
    const history = buildHistory({
      ...LISTS,
      analyses: [analysis(11, CV_OLD.id, ROLE_A.id, { status: 'failed', match_score: null })],
    })

    expect(history[0].match).toMatchObject({ id: 11, status: 'failed' })
  })

  it('orders records by their most recent run', () => {
    const history = buildHistory({
      ...LISTS,
      analyses: [analysis(11, CV_OLD.id, ROLE_A.id, { created_at: '2026-06-01T10:00:00Z' })],
      sessions: [session(41, CV_NEW.id, ROLE_B.id, { created_at: '2026-07-25T10:00:00Z' })],
    })

    expect(history.map((entry) => entry.roleId)).toEqual([ROLE_B.id, ROLE_A.id])
  })

  it('keeps a record whose documents are no longer on file', () => {
    // A resume deleted from the admin must not take its scores with it, or the
    // history silently loses runs the candidate remembers making.
    const history = buildHistory({
      resumes: [],
      roles: [],
      analyses: [analysis(11, 99, 98)],
    })

    expect(history).toHaveLength(1)
    expect(history[0].resume).toBeNull()
    expect(history[0].role).toBeNull()
    expect(history[0].match.id).toBe(11)
  })
})

describe('sessionSummary', () => {
  it('reports a debrief score once there is one', () => {
    expect(sessionSummary(session(41, 1, 5, { report: { status: 'complete', overall_score: 74 } }))).toBe(
      'Debriefed · 74 / 100'
    )
  })

  it('reports progress while the interview is unfinished', () => {
    expect(sessionSummary(session(41, 1, 5, { answered_count: 3 }))).toBe('3 of 8 answered')
  })

  it('names the two states that have no progress to report', () => {
    expect(sessionSummary(session(41, 1, 5, { status: 'pending' }))).toBe('Writing questions…')
    expect(sessionSummary(session(41, 1, 5, { status: 'failed' }))).toBe(
      'Stopped before any questions'
    )
  })
})
