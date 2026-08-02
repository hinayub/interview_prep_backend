import { apiSlice } from '../apiSlice'
import { candidateLoaded, credentialsReceived } from '../authSlice'

export const authApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    register: build.mutation({
      query: (body) => ({ url: 'auth/register/', method: 'POST', body }),
      // Register returns a token pair, so a new user lands signed in rather than
      // being bounced to the login form they just filled out.
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled
        dispatch(credentialsReceived(data))
      },
    }),

    login: build.mutation({
      query: (body) => ({ url: 'auth/login/', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled
        dispatch(credentialsReceived(data))
      },
    }),

    getMe: build.query({
      query: () => 'candidates/me/',
      providesTags: ['Candidate'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled
        dispatch(candidateLoaded(data))
      },
    }),
  }),
})

export const { useRegisterMutation, useLoginMutation, useGetMeQuery } = authApi
