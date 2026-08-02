import { skipToken } from '@reduxjs/toolkit/query'
import { useSelector } from 'react-redux'

import { apiSlice } from '../apiSlice'

/**
 * The interview endpoints.
 *
 * One session detail read carries the whole rehearsal — questions, answers,
 * evaluations and the report — so there is exactly one thing to poll no matter how
 * many agents are working. Answering question three while question two is still
 * being scored and the report is being rewritten is three concurrent agents and
 * still one request every two seconds.
 */
const POLL_MS = 2000

export const interviewsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listInterviews: build.query({
      query: () => 'interviews/',
      providesTags: ['Questions', 'History'],
    }),

    getInterview: build.query({
      query: (id) => `interviews/${id}/`,
      providesTags: (result, error, id) => [{ type: 'Questions', id }],
    }),

    startInterview: build.mutation({
      query: ({ resume, jobDescription, matchAnalysis }) => ({
        url: 'interviews/',
        method: 'POST',
        body: {
          resume,
          job_description: jobDescription,
          // Optional: it is what makes the questions target this application's gaps.
          // Omitted rather than sent as null when there is no analysis to link.
          ...(matchAnalysis ? { match_analysis: matchAnalysis } : {}),
        },
      }),
      invalidatesTags: ['Questions', 'History'],
    }),

    submitAnswer: build.mutation({
      query: ({ sessionId, question, text, secondsTaken }) => ({
        url: `interviews/${sessionId}/answers/`,
        method: 'POST',
        body: { question, text, seconds_taken: secondsTaken },
      }),
      /**
       * Invalidating the session is what starts the poll for this answer's score.
       * The submitted answer arrives with a pending evaluation attached, so the
       * refetch immediately shows "scoring…" against the right question rather
       * than leaving the page looking unchanged.
       */
      invalidatesTags: (result, error, { sessionId }) => [
        { type: 'Questions', id: sessionId },
        'History',
      ],
    }),

    /**
     * Retry the scores that failed, for the whole session at once.
     *
     * An answer cannot be resubmitted, so this is the only route back from a failure
     * the candidate did not cause — a key that was not set, a model that was retired.
     * Invalidating the session restarts the poll, so the answers go straight back to
     * "scoring…" rather than sitting on their old error until a reload.
     */
    rescoreAnswers: build.mutation({
      query: (sessionId) => ({ url: `interviews/${sessionId}/rescore/`, method: 'POST' }),
      invalidatesTags: (result, error, sessionId) => [
        { type: 'Questions', id: sessionId },
        'History',
      ],
    }),

    buildReport: build.mutation({
      query: (sessionId) => ({ url: `interviews/${sessionId}/report/`, method: 'POST' }),
      invalidatesTags: (result, error, sessionId) => [
        { type: 'Questions', id: sessionId },
        'Report',
        'History',
      ],
    }),
  }),
})

export const {
  useListInterviewsQuery,
  useGetInterviewQuery,
  useStartInterviewMutation,
  useSubmitAnswerMutation,
  useRescoreAnswersMutation,
  useBuildReportMutation,
} = interviewsApi

/**
 * Is anything on this session still being worked on by an agent?
 *
 * Three independent things can be in flight, and the page must keep polling while
 * *any* of them is: the question set, any one answer's score, and the report. Asking
 * only about session.status would stop polling the moment the questions landed and
 * leave every evaluation stuck on "scoring…" until the user reloaded.
 */
export function isWorking(session) {
  if (!session) return false
  if (session.status === 'pending') return true
  if (session.report?.status === 'pending') return true
  return (session.questions ?? []).some(
    (question) => question.answer?.evaluation?.status === 'pending'
  )
}

/**
 * Poll one interview until every agent working on it has finished.
 *
 * The interval is read off the cached row rather than the returned one, because
 * deciding whether to keep polling from the value this same call is about to
 * produce is circular. A session we have never seen counts as working, so the first
 * render after a POST starts the timer.
 */
export function useInterview(id) {
  const cached = useSelector((state) =>
    id ? interviewsApi.endpoints.getInterview.select(id)(state).data : undefined
  )
  const working = !cached || isWorking(cached)

  return useGetInterviewQuery(id ?? skipToken, {
    pollingInterval: working ? POLL_MS : 0,
    // A background tab does not need to keep asking; it refetches on focus.
    skipPollingIfUnfocused: true,
  })
}
