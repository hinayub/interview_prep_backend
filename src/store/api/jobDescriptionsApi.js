import { apiSlice } from '../apiSlice'

export const jobDescriptionsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listJobDescriptions: build.query({
      query: () => 'job-descriptions/',
      providesTags: ['JobDescription'],
    }),

    createJobDescription: build.mutation({
      query: (body) => ({ url: 'job-descriptions/', method: 'POST', body }),
      invalidatesTags: ['JobDescription', 'History'],
    }),
  }),
})

export const { useListJobDescriptionsQuery, useCreateJobDescriptionMutation } = jobDescriptionsApi
