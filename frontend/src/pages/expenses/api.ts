import { useMutation, useQuery } from '@tanstack/react-query'
import { api, unwrap, withDocumentTimeout } from '../../api/client'
import type { components } from '../../api/schema'
import { useInvalidateExpenses } from '../../api/invalidate'

export type Expense = components['schemas']['ExpenseBatch']['items'][number]
export type ExpenseCreate = components['schemas']['ExpenseCreate']
export type ExpenseCategory = Expense['category']
export const CATEGORIES: ExpenseCategory[] = [
  'rent',
  'salary',
  'customer_delivery',
  'communication',
  'advertising',
  'taxes',
  'bank',
  'other',
]

export function useExpenses(from: string, to: string, page: number, enabled = true) {
  return useQuery({
    queryKey: ['expenses', 'list', from, to, page],
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/api/expenses', {
          params: { query: { from, to, limit: 50, offset: (page - 1) * 50 } },
        }),
      ),
  })
}

export function usePreviousExpenses(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['expenses', 'previous', from, to],
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const items: Expense[] = []
      let total = 1
      while (items.length < total) {
        const page = await unwrap(
          api.GET('/api/expenses', {
            params: {
              query: {
                from,
                to,
                category: ['rent', 'salary'],
                status: 'posted',
                limit: 200,
                offset: items.length,
              },
            },
          }),
        )
        items.push(...page.items)
        total = page.total
        if (!page.items.length) break
      }
      return items
    },
  })
}

export function usePostExpenses() {
  const invalidate = useInvalidateExpenses()
  return useMutation({
    meta: { handlesError: true },
    mutationFn: (body: ExpenseCreate) =>
      withDocumentTimeout((signal) => unwrap(api.POST('/api/expenses', { body, signal }))),
    onSuccess: invalidate,
  })
}

export function useCancelExpense(id: number) {
  const invalidate = useInvalidateExpenses()
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST('/api/expenses/{expense_id}/cancel', {
          params: { path: { expense_id: id } },
          body: { reason },
        }),
      ),
    onSuccess: invalidate,
  })
}
