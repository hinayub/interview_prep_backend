import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import CallSheet from '../components/CallSheet'
import CueLamp from '../components/CueLamp'
import InterviewRail from '../components/InterviewRail'
import Notice from '../components/Notice'
import QuestionCard from '../components/QuestionCard'
import ReportCard from '../components/ReportCard'
import { ArrowIcon, DocumentIcon, TargetIcon } from '../components/icons'
import { buildCues } from '../lib/cues'
import { EMPTY_PAIR, PAIR_DRAFT, readDraft } from '../lib/draft'
import { errorMessage } from '../lib/errors'
import {
  failedScores,
  firstUnansweredIndex,
  isFinished,
  isReadyForReport,
  runningAverage,
} from '../lib/interview'
import { readTarget, uploadLink } from '../lib/links'
import {
  useBuildReportMutation,
  useInterview,
  useListInterviewsQuery,
  useRescoreAnswersMutation,
  useStartInterviewMutation,
  useSubmitAnswerMutation,
} from '../store/api/interviewsApi'
import { useListJobDescriptionsQuery } from '../store/api/jobDescriptionsApi'
import { useListMatchAnalysesQuery } from '../store/api/matchApi'
import { useListResumesQuery } from '../store/api/resumesApi'

/**
 * Step 3: answer the questions, one at a time.
 *
 * Like MatchReport, the page holds one id — the session being taken — and reads
 * everything else off the server. There is no local copy of "which question am I
 * on": that is derived from which questions have answers, so a reload drops the
 * candidate back exactly where they were rather than at the start.
 *
 * One question is on screen at a time, and it is the first unanswered one. Showing
 * all eight at once would let a candidate read question six while answering question
 * one, which is not what the interview they are rehearsing for will do.
 *
 * Which session that is defaults to the newest, and a record opened from the history
 * rail names one in the query string instead (see lib/links.js) — that is what makes
 * "Interview 2" of a pair openable rather than only ever the last one sat.
 */
export default function Interview() {
  const [searchParams] = useSearchParams()
  const target = readTarget(searchParams, 'session')

  const { data: resumes = [], isLoading: loadingResumes } = useListResumesQuery()
  const { data: roles = [], isLoading: loadingRoles } = useListJobDescriptionsQuery()
  const { data: analyses = [] } = useListMatchAnalysesQuery()
  const { data: sessions = [], isLoading: loadingSessions } = useListInterviewsQuery()

  const [startInterview, starting] = useStartInterviewMutation()
  const [submitAnswer, submission] = useSubmitAnswerMutation()
  const [buildReport, reportRun] = useBuildReportMutation()
  const [rescoreAnswers, rescoreRun] = useRescoreAnswersMutation()

  const [watchedId, setWatchedId] = useState(null)
  // Set only when the candidate navigates back to a finished question; null means
  // "wherever the interview actually is", which is the normal case.
  const [reviewIndex, setReviewIndex] = useState(null)

  /**
   * The session the URL asked for, but only if the candidate actually has it.
   *
   * Resolved through the list rather than trusted, so a stale bookmark or a deleted
   * session falls back to the newest interview instead of being polled forever and
   * rendering the server's 404 as a broken page.
   */
  const requested = sessions.find((row) => row.id === target.rowId) ?? null

  // watchedId first: a session we just started is not in the list yet.
  const sessionId = watchedId ?? requested?.id ?? sessions[0]?.id ?? null

  // The application this tab is working on, for when the URL names nothing. Read
  // once: it does not change while this page is open.
  const bench = useMemo(() => ({ ...EMPTY_PAIR, ...readDraft(PAIR_DRAFT) }), [])

  // Which two documents the panel names and the next run will use. A pair in the URL
  // wins; then the pair the requested session was sat against, so a record opened
  // from history offers another interview on *that* application rather than on
  // whatever was uploaded since; then the pair on the bench; then the newest of each.
  const resume =
    resumes.find(
      (row) => row.id === (target.resumeId ?? requested?.resume ?? bench.resumeId)
    ) ??
    resumes[0] ??
    null
  const role =
    roles.find(
      (row) => row.id === (target.roleId ?? requested?.job_description ?? bench.roleId)
    ) ??
    roles[0] ??
    null

  // The completed analysis whose gaps the questions will target: this pair's own if
  // it has one, otherwise the newest on file. Preferring the pair's own is what stops
  // a record's questions being aimed at the gaps of an unrelated application.
  const analysis =
    analyses.find(
      (row) =>
        row.status === 'complete' &&
        row.resume === resume?.id &&
        row.job_description === role?.id
    ) ??
    analyses.find((row) => row.status === 'complete') ??
    null

  const polled = useInterview(sessionId)
  const session = polled.data ?? sessions.find((row) => row.id === sessionId) ?? null

  const questions = session?.questions ?? []
  const liveIndex = firstUnansweredIndex(questions)
  const finished = isFinished(session)
  const readyForReport = isReadyForReport(session)
  const unscored = failedScores(session)
  const average = runningAverage(session)

  // Leaving review as soon as the interview moves on: without this, submitting an
  // answer while looking back at question two would leave the page stuck there.
  useEffect(() => {
    setReviewIndex(null)
  }, [liveIndex, sessionId])

  // Finishing the interview *is* the request for the debrief — there is nothing a
  // candidate who answered every question could want next, so making them ask for it
  // is a button that only ever has one answer.
  //
  // Fired from an effect on the polled session rather than from handleAnswer, because
  // when the last submit resolves its score is still being written and a report built
  // then would not cover the answer that triggered it. Guarded by a ref holding the
  // session id: between this POST and the refetch that carries the row back,
  // session.report is still null and the effect would otherwise fire again on every
  // poll. The ref keeps it to one automatic build per session, while leaving the
  // explicit re-runs below free to ask for more.
  const autoRequested = useRef(null)
  useEffect(() => {
    if (!session || !readyForReport) return
    // Checked before anything else, so this can fire at most once per session however
    // the conditions below move afterwards. That is what makes the failed-report case
    // safe to retry rather than a loop.
    if (autoRequested.current === session.id) return
    // A failed report is worth rebuilding — the usual reason it failed is that
    // nothing had been scored yet, which a re-score changes. A complete or in-flight
    // one is not.
    if (session.report && session.report.status !== 'failed') return

    autoRequested.current = session.id
    // Errors surface through reportRun.error, which offers the manual retry below.
    buildReport(session.id)
  }, [session, readyForReport, buildReport])

  // Review beats the live question; and once there is no live question left, the
  // last one stays on screen. Without that fallback, submitting the final answer
  // would clear the card and take its feedback with it — the candidate would have
  // answered a question and been shown nothing back.
  const shownIndex =
    reviewIndex ?? liveIndex ?? (questions.length ? questions.length - 1 : null)
  const shown = shownIndex === null ? null : questions[shownIndex]

  const loading = loadingResumes || loadingRoles || loadingSessions
  const ready = Boolean(resume && role)
  const generating = session?.status === 'pending'

  async function handleStart() {
    try {
      const started = await startInterview({
        resume: resume.id,
        jobDescription: role.id,
        matchAnalysis: analysis?.id,
      }).unwrap()
      setWatchedId(started.id)
      setReviewIndex(null)
    } catch {
      // Rendered from starting.error below.
    }
  }

  async function handleAnswer({ text, secondsTaken }) {
    try {
      await submitAnswer({ sessionId: session.id, question: shown.id, text, secondsTaken }).unwrap()
    } catch {
      // Rendered from submission.error, next to the box that was typed into.
    }
  }

  async function handleRescore() {
    try {
      await rescoreAnswers(session.id).unwrap()
      // A fresh debrief is owed once the scores land, and the ref guard would
      // otherwise count this session as already asked.
      autoRequested.current = null
    } catch {
      // Rendered from rescoreRun.error below.
    }
  }

  async function handleReport() {
    try {
      await buildReport(session.id).unwrap()
    } catch {
      // Rendered from reportRun.error below.
    }
  }

  const cues = buildCues({ resume, role, match: analyses[0] ?? null, session })

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:py-14">
      <header className="max-w-2xl">
        <p className="eyebrow">Step 3 of 3</p>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
          Sit the interview, then read what it cost you
        </h1>
        <p className="mt-4 leading-relaxed text-dusk">
          Eight questions written from your CV and this posting — including the gaps the
          match found, because a real interviewer will ask about those too. One question at
          a time, no going back, and a score on every answer.
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
        <div className="space-y-6">
          {!loading && !ready && (
            <section className="panel p-6">
              <h2 className="font-display text-base font-bold tracking-[-0.01em]">
                There is no interview to sit yet
              </h2>
              <p className="mt-2 leading-relaxed text-dusk">
                The questions are written from your CV and the posting, so both have to
                exist first.
              </p>
              <Link
                to={uploadLink({ resumeId: resume?.id, roleId: role?.id })}
                className="btn-lamp group mt-5 text-sm"
              >
                Back to step 1
                <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </section>
          )}

          {ready && (
            <section className="panel p-5">
              <h2 className="sr-only">What the questions will be written from</h2>

              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                <dl className="grid min-w-0 flex-1 gap-5 sm:grid-cols-2 sm:divide-x sm:divide-seam">
                  <div className="min-w-0 sm:pr-6">
                    <dt className="eyebrow mb-1.5 flex items-center gap-1.5">
                      <DocumentIcon className="size-3.5 text-shade" />
                      Your resume
                    </dt>
                    <dd className="truncate text-sm text-lit-soft">{resume.filename}</dd>
                    <dd className="mt-0.5 font-mono text-eyebrow text-shade">
                      {analysis
                        ? `${analysis.missing_skills.length} gap${analysis.missing_skills.length === 1 ? '' : 's'} will be probed`
                        : 'No match run — questions from the documents alone'}
                    </dd>
                  </div>

                  <div className="min-w-0 sm:pl-6">
                    <dt className="eyebrow mb-1.5 flex items-center gap-1.5">
                      <TargetIcon className="size-3.5 text-shade" />
                      The role
                    </dt>
                    <dd className="truncate text-sm text-lit-soft">{role.title}</dd>
                    <dd className="mt-0.5 truncate font-mono text-eyebrow text-shade">
                      {role.company || 'No company given'}
                    </dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={handleStart}
                  disabled={starting.isLoading || generating}
                  className="btn-lamp shrink-0 text-sm"
                >
                  {starting.isLoading || generating
                    ? 'Writing questions…'
                    : session
                      ? 'Start a fresh interview'
                      : 'Start the interview'}
                </button>
              </div>
            </section>
          )}

          <Notice>{starting.error ? errorMessage(starting.error) : null}</Notice>
          <Notice>
            {polled.error
              ? errorMessage(polled.error, 'Lost track of that interview. Start another one.')
              : null}
          </Notice>

          {generating && (
            <section className="panel overflow-hidden" aria-busy="true">
              <header className="flex items-center gap-2 border-b border-seam bg-flat/60 px-5 py-4">
                <CueLamp state="live" pulse />
                <span className="eyebrow text-sodium">Writing your questions</span>
              </header>

              <div className="px-5 py-6">
                <div className="relative h-2 overflow-hidden rounded-full bg-seam">
                  <span
                    aria-hidden="true"
                    className="animate-sweep absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-sodium"
                  />
                </div>

                <p className="mt-6 text-sm leading-relaxed text-dusk" role="status">
                  Your CV and the posting are being read to write questions specific to
                  this application. The local model writes these, with the hosted one
                  standing by, so it usually takes 30 to 90 seconds. You can leave this
                  page open.
                </p>
              </div>
            </section>
          )}

          {session?.status === 'failed' && (
            <section className="panel overflow-hidden">
              <header className="border-b border-seam bg-flat/60 px-5 py-4">
                <span className="eyebrow text-tally">Stopped</span>
              </header>
              <div className="space-y-4 px-5 py-5">
                <p role="alert" className="text-sm leading-relaxed text-lit-soft">
                  {session.error_message || 'The agent stopped before writing any questions.'}
                </p>
                {ready && (
                  <button type="button" onClick={handleStart} className="btn-plain text-sm">
                    Try again
                  </button>
                )}
              </div>
            </section>
          )}

          {shown && (
            <>
              {reviewIndex !== null && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <p className="text-sm text-dusk">
                    Looking back at an answer you already gave.
                  </p>
                  <button
                    type="button"
                    onClick={() => setReviewIndex(null)}
                    className="btn-quiet text-sm"
                  >
                    Back to question {(liveIndex ?? 0) + 1}
                  </button>
                </div>
              )}

              <QuestionCard
                key={shown.id}
                question={shown}
                total={questions.length}
                current={reviewIndex === null}
                onSubmit={handleAnswer}
                submitting={submission.isLoading}
                error={submission.error ? errorMessage(submission.error) : null}
              />
            </>
          )}

          {/* Above the debrief panel on purpose: an unscored answer is why the debrief
              is thin or missing, so the fix for it should be read first. */}
          {unscored.length > 0 && (
            <section className="panel p-5">
              <h2 className="font-display text-base font-bold tracking-[-0.01em]">
                {unscored.length === questions.length
                  ? 'None of your answers could be scored'
                  : `${unscored.length} of your ${questions.length} answers could not be scored`}
              </h2>
              <p className="mt-2 leading-relaxed text-dusk">
                Your answers are saved. This is almost always a configuration problem rather
                than anything you wrote — the reason is under the answer itself — so it is
                worth fixing and trying again.
              </p>

              <button
                type="button"
                onClick={handleRescore}
                disabled={rescoreRun.isLoading}
                className="btn-lamp mt-5 text-sm"
              >
                {rescoreRun.isLoading
                  ? 'Starting…'
                  : unscored.length === 1
                    ? 'Score that answer again'
                    : 'Score those answers again'}
              </button>

              <Notice>{rescoreRun.error ? errorMessage(rescoreRun.error) : null}</Notice>
            </section>
          )}

          {finished && (
            <section className="panel p-5">
              <h2 className="font-display text-base font-bold tracking-[-0.01em]">
                That is all {questions.length} answered
              </h2>
              <p className="mt-2 leading-relaxed text-dusk">
                {unscored.length === questions.length
                  ? 'A debrief has to have at least one scored answer to read, so it will be written once the scores above go through.'
                  : !readyForReport
                    ? 'Your debrief starts as soon as the last score lands — it reads every scored answer together to find the pattern across them.'
                    : 'Your debrief reads every scored answer together and tells you what to work on first.'}
              </p>

              {/* Only ever a recovery path now that finishing asks for the debrief on
                  its own: a re-run once more answers are scored, or a second attempt
                  when the automatic request itself never reached the server. */}
              {(session.report?.is_stale || (!session.report && reportRun.error)) && (
                <button
                  type="button"
                  onClick={handleReport}
                  disabled={reportRun.isLoading}
                  className="btn-lamp mt-5 text-sm"
                >
                  {reportRun.isLoading
                    ? 'Starting…'
                    : session.report?.is_stale
                      ? 'Update the debrief'
                      : 'Write my debrief'}
                </button>
              )}

              {session.report?.is_stale && (
                <p className="mt-3 text-sm leading-relaxed text-shade">
                  More of your answers have been scored since this debrief was written, so it
                  is out of date.
                </p>
              )}
            </section>
          )}

          <Notice>{reportRun.error ? errorMessage(reportRun.error) : null}</Notice>

          <ReportCard
            report={session?.report}
            session={session}
            onRetry={session?.report?.status !== 'pending' ? handleReport : undefined}
          />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-10 lg:self-start">
          {questions.length > 0 && (
            <InterviewRail
              questions={questions}
              currentIndex={shownIndex}
              onJump={setReviewIndex}
              session={session}
            />
          )}

          {average !== null && !finished && (
            <div className="panel p-5">
              <h2 className="eyebrow mb-2">Running average</h2>
              <p className="font-display text-2xl font-extrabold tracking-[-0.03em] tabular-nums">
                {average}
                <span className="ml-0.5 font-sans text-sm font-medium text-shade">/100</span>
              </p>
              <p className="mt-1.5 font-mono text-eyebrow leading-relaxed text-shade">
                Across the answers scored so far. The debrief may land somewhere else — it
                reads them together.
              </p>
            </div>
          )}

          <CallSheet cues={cues} />

          <p className="px-1 text-sm leading-relaxed text-shade">
            Every interview is kept, so you can sit another one after working on the gaps
            and compare.
          </p>
        </aside>
      </div>
    </div>
  )
}
