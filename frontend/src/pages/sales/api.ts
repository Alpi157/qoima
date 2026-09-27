import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import type { ErrorCode } from '../../api/errors'
import { useInvalidateSales } from '../../api/invalidate'
import { queryKeys, type SaleListParams } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type Sale = components['schemas']['SaleOut']
export type SaleListItem = components['schemas']['SaleListItem']
export type SaleCreate = components['schemas']['SaleCreate']
export type SaleStatus = SaleListItem['status']

// The request_id was already used by a sale with other contents.
export const SALE_REQUEST_CONFLICT: ErrorCode = 'sale_request_conflict'

export function isSaleStatus(value: string): value is SaleStatus {
  return value === 'posted' || value === 'cancelled'
}

export function useSales(params: SaleListParams) {
  return useQuery({
    queryKey: queryKeys.sales(params),
    queryFn: () =>
      unwrap(
        api.GET('/api/sales', {
          params: {
            query: {
              date_from: params.from || undefined,
              date_to: params.to || undefined,
              customer_id: params.customerId,
              status: params.status && isSaleStatus(params.status) ? params.status : undefined,
              limit: PAGE_SIZE,
              offset: pageOffset(params.page),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useSale(id: number) {
  return useQuery({
    queryKey: queryKeys.sale(id),
    queryFn: () => unwrap(api.GET('/api/sales/{sale_id}', { params: { path: { sale_id: id } } })),
    meta: { handlesNotFound: true },
  })
}

export function usePostSale() {
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: (body: SaleCreate) => unwrap(api.POST('/api/sales', { body })),
    onSuccess: invalidate,
  })
}

export function useCancelSale(id: number) {
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST('/api/sales/{sale_id}/cancel', {
          params: { path: { sale_id: id } },
          body: { reason },
        }),
      ),
    onSuccess: invalidate,
  })
}
