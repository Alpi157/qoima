import { notifications } from '@mantine/notifications'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import i18n from 'i18next'

import { apiErrorText } from '../i18n/errorText'
import { isApiError, isClientError, isServerOrNetworkError } from './errors'

const MAX_RETRIES = 1

function showError(error: unknown): void {
  notifications.show({
    color: 'red',
    title: i18n.t('common.error'),
    message: apiErrorText(error),
  })
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error, query) {
      // 401 is handled by the redirect to /login.
      if (isApiError(error) && error.status === 401) return
      // Detail pages show their own "not found" state.
      if (isApiError(error) && error.status === 404 && query.meta?.handlesNotFound) return
      showError(error)
    },
  }),
  mutationCache: new MutationCache({
    onError(error) {
      // Forms show 4xx themselves next to the fields; only unexpected failures go here.
      if (isServerOrNetworkError(error)) showError(error)
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !isClientError(error) && failureCount < MAX_RETRIES,
      refetchOnWindowFocus: false,
    },
  },
})
