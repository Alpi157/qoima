import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api, unwrap } from '../api/client'
import type { components } from '../api/schema'
import { applyLanguage, type Language } from '../i18n/language'

export type CurrentUser = components['schemas']['UserOut']

export const ME_QUERY_KEY = ['me'] as const

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => unwrap(api.GET('/api/auth/me')),
    staleTime: Infinity,
  })
}

/**
 * After login the interface speaks the user's language from the server. Runs when the saved
 * locale changes (login, another device), not on every switch, so a pending save is not undone.
 */
export function useUserLanguage(user: CurrentUser | undefined): void {
  const locale = user?.locale
  useEffect(() => {
    if (locale) void applyLanguage(locale)
  }, [locale])
}

/** Switches the language at once and saves it as the user's locale. */
export function useChangeMyLanguage() {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (locale: Language) => unwrap(api.PATCH('/api/auth/me', { body: { locale } })),
    onSuccess: (user) => queryClient.setQueryData(ME_QUERY_KEY, user),
  })
  return {
    change: (language: Language) => {
      void applyLanguage(language)
      save.mutate(language)
    },
    isPending: save.isPending,
  }
}
