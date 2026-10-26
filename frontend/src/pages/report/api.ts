import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type ReportSummary = components['schemas']['SummaryOut']
export type ReportDay = components['schemas']['DayOut']
export type ReportProduct = components['schemas']['ProductReportItem']
export type ReportCustomer = components['schemas']['CustomerReportItem']
export type ReportAdjustment = components['schemas']['AdjustmentReportItem']
export type AdjustmentDirection = NonNullable<
  import('../../api/schema').paths['/api/reports/adjustments']['get']['parameters']['query']
>['direction']

export function useReportAdjustments(
  from: string,
  to: string,
  direction: AdjustmentDirection,
  page: number,
) {
  return useQuery({
    queryKey: queryKeys.reportAdjustments(from, to, direction, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/reports/adjustments', {
          params: { query: { from, to, direction, limit: PAGE_SIZE, offset: pageOffset(page) } },
        }),
      ),
  })
}

export function useReportSummary(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reportSummary(from, to),
    enabled,
    queryFn: () => unwrap(api.GET('/api/reports/summary', { params: { query: { from, to } } })),
  })
}

export function useReportProducts(from: string, to: string, limit: number, page: number) {
  return useQuery({
    queryKey: queryKeys.reportProducts(from, to, limit, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/reports/products', {
          params: { query: { from, to, limit, offset: (page - 1) * limit } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useReportCustomers(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.reportCustomers(from, to),
    queryFn: () =>
      unwrap(api.GET('/api/reports/customers', { params: { query: { from, to, limit: 10 } } })),
  })
}
