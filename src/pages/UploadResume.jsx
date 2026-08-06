import { useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import CallSheet from '../components/CallSheet'
import Field from '../components/Field'
import HistoryRail from '../components/HistoryRail'
import Notice from '../components/Notice'
import PairRuns from '../components/PairRuns'
import ParsedPreview from '../components/ParsedPreview'
import ResumeDropZone from '../components/ResumeDropZone'
import SavedRole from '../components/SavedRole'
import { ArrowIcon } from '../components/icons'
import { buildCues } from '../lib/cues'
import {
  EMPTY_PAIR,
  PAIR_DRAFT,
  ROLE_DRAFT,
  clearWorkspace,
  readDraft,
  writeDraft,
} from '../lib/draft'
import { errorMessage } from '../lib/errors'
import { buildHistory, pairKey, whenLabel } from '../lib/history'
import { matchLink, readTarget } from '../lib/links'
import { selectIsAuthenticated } from '../store/authSlice'
import { useCreateJobDescriptionMutation, useListJobDescriptionsQuery } from '../store/api/jobDescriptionsApi'
import { useListInterviewsQuery } from '../store/api/interviewsApi'
import { useListMatchAnalysesQuery } from '../store/api/matchApi'
import { useListResumesQuery, useUploadResumeMutation } from '../store/api/resumesApi'

const MIN_JD_CHARS = 100
const EMPTY_ROLE = { title: '', company: '', raw_text: '' }

export default function UploadResume() {
  const isAuthenticated = useSelector(selectIsAuthenticated)
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const target = readTarget(searchParams)

  const { data: resumes = [], isLoading: loadingResumes } = useListResumesQuery()
  const { data: jobDescriptions = [] } = useListJobDescriptionsQuery()
  const { data: analyses = [] } = useListMatchAnalysesQuery()
  const { data: sessions = [] } = useListInterviewsQuery()

  const [uploadResume, upload] = useUploadResumeMutation()
  const [createJobDescription, jdRequest] = useCreateJobDescriptionMutation()

  const [pendingName, setPendingName] = useState(null)
  // Restored from the tab's draft, so a session that expired mid-form does not
  // cost the candidate the posting they pasted.
  const [role, setRole] = useState(() => ({ ...EMPTY_ROLE, ...readDraft(ROLE_DRAFT) }))
  const [savedRole, setSavedRole] = useState(null)
  // Which action was blocked by a missing session: 'cv', 'role', or null. Kept
  // per-action so the prompt appears next to the button that was just pressed.
  const [needsSignIn, setNeedsSignIn] = useState(null)
  /**
   * The two documents this tab is working against, restored from the tab's draft.
   *
   * Not "the newest row on file". Signing in has to open an empty bench — a new
   * application, the way a new conversation opens empty — rather than silently
   * resuming the one finished last week. It is also what every run attaches to, so
   * reading it off the newest rows would let an upload made after a posting was
   * saved land the match in a record of its own.
   */
  const [pair, setPair] = useState(() => ({ ...EMPTY_PAIR, ...readDraft(PAIR_DRAFT) }))

  function editRole(patch) {
    const next = { ...role, ...patch }
    setRole(next)
    writeDraft(ROLE_DRAFT, next)
  }

  function keepPair(patch) {
    const next = { ...pair, ...patch }
    setPair(next)
    writeDraft(PAIR_DRAFT, next)
  }

  // A row created a moment ago is not in its list yet; the POST result stands in
  // until the refetch lands, so the page never blinks back to "nothing here".
  const held = (list, fresh, id) => {
    if (!id) return null
    if (fresh?.id === id) return fresh
    return list.find((row) => row.id === id) ?? null
  }

  const benchResume = held(resumes, upload.data, pair.resumeId)
  const benchRole = held(jobDescriptions, jdRequest.data, pair.roleId)

  const history = useMemo(
    () => buildHistory({ resumes, roles: jobDescriptions, analyses, sessions }),
    [resumes, jobDescriptions, analyses, sessions]
  )

  const benchKey = pairKey(pair.resumeId, pair.roleId)

  /**
   * Which record is open.
   *
   * A pair named in the URL wins, so a row clicked in the rail survives walking to
   * the match page and back. Otherwise the bench's own pair — once something has
   * been run against it, it *is* a record, and arriving at a bare /app should show
   * that rather than an empty form beside it.
   *
   * Either way it is resolved through the history list, so a pair with nothing run
   * against it yet leaves the form on screen, and a record dropped by a refetch
   * falls back to the bench rather than rendering a document that is gone.
   */
  const openKey = pairKey(target.resumeId, target.roleId) ?? benchKey
  const open = history.find((entry) => entry.key === openKey) ?? null

  /** What the bench has already produced, for the sidebar and the way forward. */
  const benchEntry = history.find((entry) => entry.key === benchKey) ?? null

  function openRecord(key) {
    const entry = key ? history.find((row) => row.key === key) : null
    setSearchParams(
      entry ? { resume: String(entry.resumeId), role: String(entry.roleId) } : {},
      { replace: true }
    )
  }

  /**
   * Clear the bench for the next application.
   *
   * Offered once the current pair has become a record: the work in this tab is
   * finished with, and the alternative is a form that quietly keeps adding runs to
   * an application the candidate has stopped thinking about.
   */
  function startNew() {
    setPair(EMPTY_PAIR)
    setRole(EMPTY_ROLE)
    setSavedRole(null)
    setNeedsSignIn(null)
    clearWorkspace()
    setSearchParams({}, { replace: true })
  }

  async function handleFile(file) {
    // Check the session before sending anything. A signed-out POST is a
    // guaranteed 401, and "please sign in" is a far more useful thing to read
    // than the server's rejection of a request that never had a chance.
    if (!isAuthenticated) {
      setNeedsSignIn('cv')
      return
    }

    setNeedsSignIn(null)
    setPendingName(file.name)
    try {
      const uploaded = await uploadResume(file).unwrap()
      // This CV is now half of what the bench is working on. Every run started from
      // here names it explicitly, which is what keeps them in one record.
      keepPair({ resumeId: uploaded.id })
    } catch {
      // Rendered from upload.error below.
    }
  }

  /**
   * Save the posting if it is not already a row, then go and run the match.
   *
   * One control, because "save" was never a thing anybody came here to do — it is
   * a step the funnel needs, not a decision. Pressing it again with the fields
   * untouched navigates without a second INSERT: a JobDescription is append-only,
   * and two identical postings would split this application across two records.
   */
  async function handleRoleSubmit(event) {
    event.preventDefault()

    if (!isAuthenticated) {
      setNeedsSignIn('role')
      return
    }

    setNeedsSignIn(null)

    let saved = roleSaved ? savedRole : null
    if (!saved) {
      try {
        const created = await createJobDescription(role).unwrap()
        // The form keeps what was typed. Wiping it reads as lost work, and the id is
        // held alongside it so a second press knows the row already exists.
        saved = { ...role, id: created.id }
        setSavedRole(saved)
        keepPair({ roleId: created.id })
      } catch (error) {
        // A 401 here means the token died between render and click: say so plainly
        // instead of letting it read as a bad job description.
        if (error?.status === 401) setNeedsSignIn('role')
        // Otherwise rendered from jdRequest.error below.
        return
      }
    }

    // A match needs both documents. Without the CV the posting is kept and the page
    // says what is still missing, rather than walking to a step that cannot run.
    if (benchResume) {
      navigate(matchLink({ resumeId: benchResume.id, roleId: saved.id }))
    }
  }

  // The sidebar describes whatever is on screen. Reading it off the live pair while a
  // saved record was open would have it contradict the two documents next to it.
  const cues = buildCues({
    resume: open ? open.resume : benchResume,
    role: open ? open.role : benchRole,
    match: open ? open.match : (benchEntry?.match ?? null),
    // Read only to keep the shared sidebar consistent with the interview page.
    session: open ? open.latestSession : (benchEntry?.latestSession ?? null),
    uploading: upload.isLoading,
    savingRole: jdRequest.isLoading,
  })

  const jdTooShort = role.raw_text.trim().length > 0 && role.raw_text.trim().length < MIN_JD_CHARS

  // `from` sends them straight back here after signing in, and the role draft is
  // waiting in sessionStorage when they arrive.
  const signInPrompt = (what) => (
    <Notice>
      {needsSignIn === what ? (
        <>
          You are signed out, so this {what === 'cv' ? 'resume' : 'role'} was not saved.{' '}
          <Link
            to="/sign-in"
            state={{ from: location }}
            className="font-medium underline underline-offset-4"
          >
            Sign in
          </Link>{' '}
          and try again — what you typed is kept.
        </>
      ) : null}
    </Notice>
  )

  // True only while the fields still hold exactly what was saved, so editing any
  // of them clears the confirmation and re-arms the button.
  const roleSaved =
    savedRole !== null &&
    savedRole.title === role.title &&
    savedRole.company === role.company &&
    savedRole.raw_text === role.raw_text

  const uploaded = open?.resume ? whenLabel(open.resume.uploaded_at) : ''

  return (
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:py-14">
      <header className="max-w-2xl">
        <p className="eyebrow">Step 1 of 3</p>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
          Give us the resume and the role
        </h1>
        <p className="mt-4 leading-relaxed text-dusk">
          We read your resume into plain text and show you exactly what we got, so a bad
          scan never turns into a bad score later.
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)_16rem] lg:gap-10">
        <div className="lg:sticky lg:top-10 lg:self-start">
          <HistoryRail
            entries={history}
            selectedKey={open?.key ?? null}
            onSelect={openRecord}
            onNew={startNew}
            // Null once the bench has become a record of its own: there is nothing
            // left to work on here, so the row turns into the way to start the next.
            bench={benchEntry ? null : { resume: benchResume, role: benchRole }}
          />
        </div>

        <div className="space-y-8">
          {open && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sodium/35 bg-sodium/12 px-4 py-3">
              <p className="text-sm leading-relaxed text-lit-soft">
                Reading a saved record. Both documents are as they were kept, and anything
                you run from here is added to it.
              </p>
              <button
                type="button"
                onClick={benchEntry ? startNew : () => openRecord(null)}
                className="btn-quiet text-sm"
              >
                {benchEntry ? 'Start a new application' : 'Back to the current one'}
              </button>
            </div>
          )}

          <section>
            <h2 className="eyebrow mb-3">Your resume</h2>

            {open ? (
              <div className="space-y-2">
                {open.resume ? (
                  <>
                    <ParsedPreview
                      text={open.resume.parsed_text}
                      filename={open.resume.filename}
                    />
                    {uploaded && (
                      <p className="px-1 font-mono text-eyebrow text-shade">Uploaded {uploaded}</p>
                    )}
                  </>
                ) : (
                  <p className="panel p-5 text-sm leading-relaxed text-dusk">
                    The CV behind this record is no longer on file. The runs below still hold
                    their results.
                  </p>
                )}
              </div>
            ) : (
              <>
                <ResumeDropZone
                  onFile={handleFile}
                  busy={upload.isLoading}
                  selectedName={upload.isLoading ? pendingName : benchResume?.filename}
                />

                <div className="mt-3 space-y-3">
                  {signInPrompt('cv')}
                  <Notice>{upload.error ? errorMessage(upload.error) : null}</Notice>
                  {benchResume && (
                    <ParsedPreview
                      text={benchResume.parsed_text}
                      filename={benchResume.filename}
                    />
                  )}
                </div>

                {!loadingResumes && resumes.length > 1 && (
                  <p className="mt-3 font-mono text-eyebrow text-shade">
                    {resumes.length} CVs on file · every upload is kept
                  </p>
                )}
              </>
            )}
          </section>

          <section>
            <h2 className="eyebrow mb-3">The role</h2>

            {open ? (
              <SavedRole role={open.role} />
            ) : (
              <form onSubmit={handleRoleSubmit} className="panel space-y-5 p-5" noValidate>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    id="jd-title"
                    label="Job title"
                    placeholder="Senior Backend Engineer"
                    value={role.title}
                    onChange={(event) => editRole({ title: event.target.value })}
                    required
                  />
                  <Field
                    id="jd-company"
                    label="Company"
                    placeholder="Optional"
                    value={role.company}
                    onChange={(event) => editRole({ company: event.target.value })}
                  />
                </div>

                <Field
                  as="textarea"
                  id="jd-text"
                  label="Job description"
                  placeholder="Paste the full posting — responsibilities, requirements, everything."
                  hint={`${role.raw_text.trim().length} / ${MIN_JD_CHARS} characters minimum`}
                  error={jdTooShort ? 'Paste more of the posting. Short descriptions produce vague questions.' : undefined}
                  value={role.raw_text}
                  onChange={(event) => editRole({ raw_text: event.target.value })}
                  required
                />

                {signInPrompt('role')}
                <Notice>{jdRequest.error ? errorMessage(jdRequest.error) : null}</Notice>
                {/* Only ever seen when Go had nowhere to go: the posting is on file,
                    and the CV is the half that is missing. */}
                <Notice tone="done">
                  {roleSaved && !benchResume
                    ? 'Your posting is kept. Add your CV above, then press Go.'
                    : null}
                </Notice>

                <div className="flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={jdRequest.isLoading || jdTooShort || !role.title.trim()}
                    className="btn-lamp group"
                  >
                    {jdRequest.isLoading ? 'Saving…' : 'Go'}
                    <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </button>

                  <span className="font-mono text-eyebrow text-shade">
                    {benchResume ? 'On to the match' : 'A CV is needed too'}
                  </span>
                </div>
              </form>
            )}
          </section>

          {open && <PairRuns key={open.key} entry={open} />}
        </div>

        <aside className="lg:sticky lg:top-10 lg:self-start">
          <CallSheet cues={cues} />

          {open ? (
            <p className="mt-4 px-1 text-sm leading-relaxed text-shade">
              This is a saved record. What was run against it is listed under the two
              documents.
            </p>
          ) : benchResume && benchRole ? (
            <Link
              to={matchLink({ resumeId: benchResume.id, roleId: benchRole.id })}
              className="btn-lamp group mt-4 w-full text-sm"
            >
              Analyse the match
              <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <p className="mt-4 px-1 text-sm leading-relaxed text-shade">
              Once both of the first two steps are green, the matching agent can run.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
