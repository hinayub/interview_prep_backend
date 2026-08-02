import { skipToken } from '@reduxjs/toolkit/query'
import { useSelector } from 'react-redux'

import { apiSlice } from '../apiSlice'

/**
 * The matching agent runs on a 3B model on CPU, which takes tens of seconds —
 * far longer than a request can be held open. So POST returns a pending row and
 * the client polls its detail endpoint until the row goes terminal.
 */
const POLL_MS = 2000

export const matchApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listMatchAnalyses: build.query({
      query: () => 'match-analyses/',
      providesTags: ['MatchAnalysis'],
    }),

    getMatchAnalysis: build.query({
      query: (id) => `match-analyses/${id}/`,
      providesTags: (result, error, id) => [{ type: 'MatchAnalysis', id }],
    }),

    startMatchAnalysis: build.mutation({
      query: ({ resume, jobDescription }) => ({
        url: 'match-analyses/',
        method: 'POST',
        body: { resume, job_description: jobDescription },
      }),
      // The list gains a row immediately, even though it has no result yet.
      invalidatesTags: ['MatchAnalysis', 'History'],
    }),
  }),
})

export const {
  useListMatchAnalysesQuery,
  useGetMatchAnalysisQuery,
  useStartMatchAnalysisMutation,
} = matchApi

/**
 * Poll one analysis until the agent is done with it.
 *
 * The polling interval is read off the cached row rather than the returned one,
 * because deciding whether to keep polling from the value the same call is about
 * to produce is circular. A row we have never seen counts as working, so the
 * first render after a POST starts the timer.
 */
export function useMatchAnalysis(id) {
  const cached = useSelector((state) =>
    id ? matchApi.endpoints.getMatchAnalysis.select(id)(state).data : undefined
  )
  const working = !cached || cached.status === 'pending'

  return useGetMatchAnalysisQuery(id ?? skipToken, {
    pollingInterval: working ? POLL_MS : 0,
    // A background tab does not need to keep asking; it refetches on focus.
    skipPollingIfUnfocused: true,
  })
}
