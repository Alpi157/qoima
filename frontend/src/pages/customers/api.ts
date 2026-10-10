import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { type CustomerListParams, queryKeys } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type Customer = components['schemas']['CustomerOut']
export type CustomerCreate = components['schemas']['CustomerCreate']
export type CustomerUpdate = components['schemas']['CustomerUpdate']
export type CustomerDebtsPage = components['schemas']['CustomerDebtsPage']
export type LedgerItem = components['schemas']['LedgerItem']

export function useCustomerDebts(page: number) {
  return useQuery({
    queryKey: queryKeys.customerDebts(page),
    queryFn: () =>
      unwrap(
        api.GET('/api/customers/debts', {
          params: { query: { limit: PAGE_SIZE, offset: pageOffset(page) } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useDebtSummary() {
  return useQuery({
    queryKey: queryKeys.debtSummary,
    queryFn: () => unwrap(api.GET('/api/customers/debts', { params: { query: { limit: 1 } } })),
  })
}

export function useCustomerLedger(id: number, page: number) {
  return useQuery({
    queryKey: queryKeys.customerLedger(id, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/customers/{customer_id}/ledger', {
          params: {
            path: { customer_id: id },
            query: { limit: PAGE_SIZE, offset: pageOffset(page) },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: queryKeys.customers(params),
    queryFn: () =>
      unwrap(
        api.GET('/api/customers', {
          params: {
            query: { q: params.q || undefined, limit: PAGE_SIZE, offset: pageOffset(params.page) },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

const CUSTOMER_SEARCH_LIMIT = 10

/** Search for a picker: by name or phone, first results only. */
export function useCustomerSearch(q: string) {
  const query = q.trim()
  return useQuery({
    queryKey: queryKeys.customerSearch(query),
    queryFn: () =>
      unwrap(
        api.GET('/api/customers', {
          params: { query: { q: query, limit: CUSTOMER_SEARCH_LIMIT } },
        }),
      ),
    enabled: query !== '',
    placeholderData: keepPreviousData,
  })
}

const RECENT_LIMIT = 6

/** «Соңғы сатып алушылар»: customers of the latest sales, then the newest ones. */
export function useRecentCustomers() {
  return useQuery({
    queryKey: queryKeys.recentCustomers,
    queryFn: () =>
      unwrap(api.GET('/api/customers/recent', { params: { query: { limit: RECENT_LIMIT } } })),
  })
}

export function useCustomer(id: number) {
  return useQuery({
    queryKey: queryKeys.customer(id),
    queryFn: () =>
      unwrap(api.GET('/api/customers/{customer_id}', { params: { path: { customer_id: id } } })),
    meta: { handlesNotFound: true },
  })
}

function useInvalidateCustomer() {
  const queryClient = useQueryClient()
  return (customer: Customer) => {
    void queryClient.invalidateQueries({ queryKey: ['customers'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.customer(customer.id) })
  }
}

export function useCreateCustomer() {
  const invalidate = useInvalidateCustomer()
  return useMutation({
    mutationFn: (body: CustomerCreate) => unwrap(api.POST('/api/customers', { body })),
    onSuccess: invalidate,
  })
}

export function useUpdateCustomer(id: number) {
  const invalidate = useInvalidateCustomer()
  return useMutation({
    mutationFn: (body: CustomerUpdate) =>
      unwrap(
        api.PATCH('/api/customers/{customer_id}', { params: { path: { customer_id: id } }, body }),
      ),
    onSuccess: invalidate,
  })
}
