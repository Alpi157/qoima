import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import type { components } from '../api/schema'

export type CurrentUser = components['schemas']['UserOut']

export const ME_QUERY_KEY = ['me'] as const

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => unwrap(api.GET('/api/auth/me')),
    staleTime: Infinity,
  })
}
