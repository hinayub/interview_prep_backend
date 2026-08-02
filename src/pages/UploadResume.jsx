import { useState } from 'react'
import { useSelector } from 'react-redux'
import { Link, useLocation } from 'react-router-dom'

import CallSheet from '../components/CallSheet'
import Field from '../components/Field'
import Notice from '../components/Notice'
import ParsedPreview from '../components/ParsedPreview'
import ResumeDropZone from '../components/ResumeDropZone'
import { ArrowIcon } from '../components/icons'
import { buildCues } from '../lib/cues'
import { ROLE_DRAFT, readDraft, writeDraft } from '../lib/draft'
import { errorMessage } from '../lib/errors'
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

  function editRole(patch) {
    const next = { ...role, ...patch }
    setRole(next)
    writeDraft(ROLE_DRAFT, next)
  }

  // The newest row wins for display, but older rows are never replaced — this is
  // a read off an append-only list, which is what Phase 7's history depends on.
  const latestResume = upload.data ?? resumes[0] ?? null
  const latestRole = jdRequest.data ?? jobDescriptions[0] ?? null

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
      await uploadResume(file).unwrap()
    } catch {
      // Rendered from upload.error below.
    }
  }

  async function handleRoleSubmit(event) {
    event.preventDefault()

    if (!isAuthenticated) {
      setNeedsSignIn('role')
      return
    }

    setNeedsSignIn(null)
    try {
      await createJobDescription(role).unwrap()
      // The form keeps what was typed. Wiping it reads as lost work, and Phase 3
      // needs this role on screen next to the CV it will be matched against.
      setSavedRole(role)
    } catch (error) {
      // A 401 here means the token died between render and click: say so plainly
      // instead of letting it read as a bad job description.
      if (error?.status === 401) setNeedsSignIn('role')
      // Otherwise rendered from jdRequest.error below.
    }
  }

  const cues = buildCues({
    resume: latestResume,
    role: latestRole,
    match: analyses[0] ?? null,
    // Read only to keep the shared sidebar consistent with the interview page.
    session: sessions[0] ?? null,
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

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:py-14">
      <header className="max-w-2xl">
        <p className="eyebrow">Step 1 of 3</p>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
          Give us the resume and the role
        </h1>
        <p className="mt-4 leading-relaxed text-slate">
          We read your resume into plain text and show you exactly what we got, so a bad
          scan never turns into a bad score later.
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
        <div className="space-y-8">
          <section>
            <h2 className="eyebrow mb-3">Your resume</h2>

            <ResumeDropZone
              onFile={handleFile}
              busy={upload.isLoading}
              selectedName={upload.isLoading ? pendingName : latestResume?.filename}
            />

            <div className="mt-3 space-y-3">
              {signInPrompt('cv')}
              <Notice>{upload.error ? errorMessage(upload.error) : null}</Notice>
              {latestResume && (
                <ParsedPreview
                  text={latestResume.parsed_text}
                  filename={latestResume.filename}
                />
              )}
            </div>

            {!loadingResumes && resumes.length > 1 && (
              <p className="mt-3 font-mono text-eyebrow text-mist">
                {resumes.length} CVs on file · every upload is kept
              </p>
            )}
          </section>

          <section>
            <h2 className="eyebrow mb-3">The role</h2>

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
              <Notice tone="done">
                {roleSaved ? 'Role saved. Edit any field above to save a new version.' : null}
              </Notice>

              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={jdRequest.isLoading || jdTooShort || !role.title.trim() || roleSaved}
                  className="btn-ink"
                >
                  {jdRequest.isLoading ? 'Saving…' : roleSaved ? 'Saved' : 'Save role'}
                </button>

                {jobDescriptions.length > 0 && (
                  <span className="font-mono text-eyebrow text-mist">
                    {jobDescriptions.length} saved
                  </span>
                )}
              </div>
            </form>
          </section>
        </div>

        <aside className="lg:sticky lg:top-10 lg:self-start">
          <CallSheet cues={cues} />

          {latestResume && latestRole ? (
            <Link to="/app/match" className="btn-ink group mt-4 w-full text-sm">
              Analyse the match
              <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <p className="mt-4 px-1 text-sm leading-relaxed text-mist">
              Once both of the first two steps are green, the matching agent can run.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
