import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../../api/client'
import { useInvalidateReturns } from '../../api/invalidate'
import { queryKeys, type ReturnListParams } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type ReturnDocument = components['schemas']['ReturnOut']
export type ReturnListItem = components['schemas']['ReturnListItem']
export type ReturnCreate = components['schemas']['ReturnCreate']

export function useReturns(params: ReturnListParams) {
  return useQuery({
    queryKey: queryKeys.returns(params),
    queryFn: () =>
      unwrap(
        api.GET('/api/returns', {
          params: {
            query: {
              from: params.from || undefined,
              to: params.to || undefined,
              limit: PAGE_SIZE,
              offset: pageOffset(params.page),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useReturn(id: number) {
  return useQuery({
    queryKey: queryKeys.return(id),
    queryFn: () =>
      unwrap(api.GET('/api/returns/{return_id}', { params: { path: { return_id: id } } })),
    meta: { handlesNotFound: true },
  })
}

export function usePostReturn() {
  const invalidate = useInvalidateReturns()
  return useMutation({
    mutationFn: (body: ReturnCreate) => unwrap(api.POST('/api/returns', { body })),
    onSuccess: invalidate,
  })
}

export function useCancelReturn(id: number) {
  const invalidate = useInvalidateReturns()
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST('/api/returns/{return_id}/cancel', {
          params: { path: { return_id: id } },
          body: { reason },
        }),
      ),
    onSuccess: invalidate,
  })
}
