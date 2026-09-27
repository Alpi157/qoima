import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { type CustomerListParams, queryKeys, type SaleListParams } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type Customer = components['schemas']['CustomerOut']
export type CustomerCreate = components['schemas']['CustomerCreate']
export type CustomerUpdate = components['schemas']['CustomerUpdate']
export type SaleListItem = components['schemas']['SaleListItem']

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

export function useCustomer(id: number) {
  return useQuery({
    queryKey: queryKeys.customer(id),
    queryFn: () =>
      unwrap(api.GET('/api/customers/{customer_id}', { params: { path: { customer_id: id } } })),
    meta: { handlesNotFound: true },
  })
}

export function useSales(params: SaleListParams) {
  return useQuery({
    queryKey: queryKeys.sales(params),
    queryFn: () =>
      unwrap(
        api.GET('/api/sales', {
          params: {
            query: {
              customer_id: params.customerId,
              limit: PAGE_SIZE,
              offset: pageOffset(params.page),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
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
