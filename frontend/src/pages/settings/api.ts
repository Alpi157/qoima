import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { components } from '../../api/schema'

export type BusinessSettings = components['schemas']['BusinessSettingsOut']
export type BusinessSettingsUpdate = components['schemas']['BusinessSettingsUpdate']

export function useBusinessSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.GET('/api/settings')),
  })
}

export function useSaveBusinessSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: BusinessSettingsUpdate) => unwrap(api.PUT('/api/settings', { body })),
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.settings, saved),
  })
}
