import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'

import { api, unwrap, withDocumentTimeout } from '../../api/client'
import { useInvalidateStock } from '../../api/invalidate'
import { queryKeys, type ReceiptListParams } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type Receipt = components['schemas']['ReceiptOut']
export type ReceiptListItem = components['schemas']['ReceiptListItem']
export type ReceiptCreate = components['schemas']['ReceiptCreate']
export type ReceiptStatus = ReceiptListItem['status']
export type ReceiptPreview = components['schemas']['ReceiptPreviewOut']
export type ReceiptWarning = ReceiptPreview['warnings'][number]

export function fetchReceiptPreview(body: components['schemas']['ReceiptPreviewIn']) {
  return unwrap(api.POST('/api/receipts/preview', { body }))
}

export function fetchReceiptDefaults(supplier: string) {
  return unwrap(api.GET('/api/receipts/defaults', { params: { query: { supplier } } }))
}

export function fetchRate(currency: 'CNY' | 'USD', date: string) {
  return unwrap(api.GET('/api/rates', { params: { query: { currency, date } } }))
}

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
    meta: { handlesError: true },
    mutationFn: (body: ReceiptCreate) =>
      withDocumentTimeout((signal) => unwrap(api.POST('/api/receipts', { body, signal }))),
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
