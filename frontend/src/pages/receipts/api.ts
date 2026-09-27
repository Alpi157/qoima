import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { useInvalidateStock } from '../../api/invalidate'
import { queryKeys, type ReceiptListParams } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type Receipt = components['schemas']['ReceiptOut']
export type ReceiptListItem = components['schemas']['ReceiptListItem']
export type ReceiptCreate = components['schemas']['ReceiptCreate']
export type ReceiptStatus = ReceiptListItem['status']

export function isReceiptStatus(value: string): value is ReceiptStatus {
  return value === 'posted' || value === 'cancelled'
}

export function useReceipts(params: ReceiptListParams) {
  return useQuery({
    queryKey: queryKeys.receipts(params),
    queryFn: () =>
      unwrap(
        api.GET('/api/receipts', {
          params: {
            query: {
              date_from: params.from || undefined,
              date_to: params.to || undefined,
              status: isReceiptStatus(params.status) ? params.status : undefined,
              limit: PAGE_SIZE,
              offset: pageOffset(params.page),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useReceipt(id: number) {
  return useQuery({
    queryKey: queryKeys.receipt(id),
    queryFn: () =>
      unwrap(api.GET('/api/receipts/{receipt_id}', { params: { path: { receipt_id: id } } })),
    meta: { handlesNotFound: true },
  })
}

export function usePostReceipt() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (body: ReceiptCreate) => unwrap(api.POST('/api/receipts', { body })),
    onSuccess: invalidate,
  })
}

export function useCancelReceipt(id: number) {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST('/api/receipts/{receipt_id}/cancel', {
          params: { path: { receipt_id: id } },
          body: { reason },
        }),
      ),
    onSuccess: invalidate,
  })
}
