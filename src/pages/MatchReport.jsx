import { useState } from 'react'
import { Link } from 'react-router-dom'

import CallSheet from '../components/CallSheet'
import MatchResult from '../components/MatchResult'
import Notice from '../components/Notice'
import { ArrowIcon, DocumentIcon, TargetIcon } from '../components/icons'
import { buildCues } from '../lib/cues'
import { errorMessage } from '../lib/errors'
import { useListInterviewsQuery } from '../store/api/interviewsApi'
import { useListJobDescriptionsQuery } from '../store/api/jobDescriptionsApi'
import {
  useListMatchAnalysesQuery,
  useMatchAnalysis,
  useStartMatchAnalysisMutation,
} from '../store/api/matchApi'
import { useListResumesQuery } from '../store/api/resumesApi'

/**
 * Step 2: score the newest resume against the newest role.
 *
 * The page holds one id — the analysis being watched — and everything else is
 * read from the server. That is what makes a reload harmless: the newest row
 * from the list is picked up and polled again if it is still pending.
 */
export default function MatchReport() {
  const { data: resumes = [], isLoading: loadingResumes } = useListResumesQuery()
  const { data: roles = [], isLoading: loadingRoles } = useListJobDescriptionsQuery()
  const { data: analyses = [], isLoading: loadingAnalyses } = useListMatchAnalysesQuery()
  const { data: sessions = [] } = useListInterviewsQuery()

  const [startAnalysis, run] = useStartMatchAnalysisMutation()
  const [watchedId, setWatchedId] = useState(null)

  const resume = resumes[0] ?? null
  const role = roles[0] ?? null

  // Whichever row we started this visit, falling back to the newest one on file.
  const analysisId = watchedId ?? analyses[0]?.id ?? null
  const polled = useMatchAnalysis(analysisId)
  const analysis = polled.data ?? analyses.find((row) => row.id === analysisId) ?? null

  // The last finished run of the same pairing, for the movement in the header. The
  // list is newest-first, so the first match behind this one is the right one.
  const previous =
    analyses.find(
      (row) =>
        row.id !== analysis?.id &&
        row.status === 'complete' &&
        row.resume === analysis?.resume &&
        row.job_description === analysis?.job_description
    ) ?? null

  const loading = loadingResumes || loadingRoles || loadingAnalyses
  const ready = Boolean(resume && role)
  const working = analysis?.status === 'pending'

  async function handleRun() {
    try {
      const started = await startAnalysis({
        resume: resume.id,
        jobDescription: role.id,
      }).unwrap()
      setWatchedId(started.id)
    } catch {
      // Rendered from run.error below.
    }
  }

  // The newest session is read only to keep the shared sidebar honest — this page
  // does nothing else with it, but a cue that said "ready to sit" to someone who has
  // already sat one would contradict the same sidebar on the next screen.
  const cues = buildCues({ resume, role, match: analysis, session: sessions[0] ?? null })

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:py-14">
      <header className="max-w-2xl">
        <p className="eyebrow">Step 2 of 3</p>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
          How well you fit, and what is missing
        </h1>
        <p className="mt-4 leading-relaxed text-slate">
          The agent reads only your resume and the posting — no invented experience, no
          padding. What comes back is a score, the reasoning behind it, and the skills the
          role asks for that your resume does not evidence.
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
        <div className="space-y-6">
          {!loading && !ready && (
            <section className="panel p-6">
              <h2 className="font-display text-base font-bold tracking-[-0.01em]">
                There is nothing to compare yet
              </h2>
              <p className="mt-2 leading-relaxed text-slate">
                {resume
                  ? 'Your CV is on file. Add the role you are applying for and the agent can run.'
                  : 'The agent needs a CV to read and a posting to read it against.'}
              </p>
              <Link to="/app" className="btn-ink group mt-5 text-sm">
                Back to step 1
                <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </section>
          )}

          {ready && (
            <section className="panel p-5">
              <h2 className="sr-only">What will be compared</h2>

              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                {/* The two documents, named the way the candidate thinks of them.
                    The hairline between them is the comparison. */}
                <dl className="grid min-w-0 flex-1 gap-5 sm:grid-cols-2 sm:divide-x sm:divide-line">
                  <div className="min-w-0 sm:pr-6">
                    <dt className="eyebrow mb-1.5 flex items-center gap-1.5">
                      <DocumentIcon className="size-3.5 text-mist" />
                      Your resume
                    </dt>
                    <dd className="truncate text-sm text-ink-soft">{resume.filename}</dd>
                    <dd className="mt-0.5 font-mono text-eyebrow text-mist">
                      {resume.parsed_text.length.toLocaleString()} characters read
                    </dd>
                  </div>

                  <div className="min-w-0 sm:pl-6">
                    <dt className="eyebrow mb-1.5 flex items-center gap-1.5">
                      <TargetIcon className="size-3.5 text-mist" />
                      The role
                    </dt>
                    <dd className="truncate text-sm text-ink-soft">{role.title}</dd>
                    <dd className="mt-0.5 truncate font-mono text-eyebrow text-mist">
                      {role.company || 'No company given'}
                    </dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={handleRun}
                  disabled={run.isLoading || working}
                  className="btn-ink shrink-0 text-sm"
                >
                  {run.isLoading || working
                    ? 'Analysing…'
                    : analysis
                      ? 'Run it again'
                      : 'Run the match'}
                </button>
              </div>
            </section>
          )}

          <Notice>{run.error ? errorMessage(run.error) : null}</Notice>
          <Notice>
            {polled.error
              ? errorMessage(polled.error, 'Lost track of that analysis. Run it again.')
              : null}
          </Notice>

          <MatchResult
            analysis={analysis}
            previous={previous}
            onRetry={ready ? handleRun : undefined}
          />

          {analysis?.status === 'complete' && (
            <section className="panel p-5">
              <h2 className="font-display text-base font-bold tracking-[-0.01em]">
                Now practise answering for it
              </h2>
              <p className="mt-2 leading-relaxed text-slate">
                Eight questions written from this resume and this posting — including{' '}
                {analysis.missing_skills.length > 0
                  ? 'the gaps above, because a real interviewer will ask about those too.'
                  : 'the specifics of your own experience rather than generic prompts.'}
              </p>
              <Link to="/app/interview" className="btn-ink group mt-5 text-sm">
                Sit the interview
                <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-10 lg:self-start">
          <CallSheet cues={cues} />

          <p className="mt-4 px-1 text-sm leading-relaxed text-mist">
            Every run is kept, so you can re-run this after editing your CV and watch the
            score move.
          </p>
        </aside>
      </div>
    </div>
  )
}
