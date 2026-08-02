import { apiSlice } from '../apiSlice'

export const resumesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listResumes: build.query({
      query: () => 'resumes/',
      providesTags: ['Resume'],
    }),

    uploadResume: build.mutation({
      query: (file) => {
        const body = new FormData()
        body.append('file', file)
        // No Content-Type header: the browser has to set the multipart boundary
        // itself, and setting it manually breaks the upload.
        return { url: 'resumes/', method: 'POST', body }
      },
      // A new resume is a new row, never a replacement, so the list is stale.
      invalidatesTags: ['Resume', 'History'],
    }),
  }),
})

export const { useListResumesQuery, useUploadResumeMutation } = resumesApi
