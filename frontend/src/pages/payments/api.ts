import { useMutation } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { useInvalidatePayments } from '../../api/invalidate'
import type { components } from '../../api/schema'

export type Payment = components['schemas']['PaymentOut']
export type PaymentCreate = components['schemas']['PaymentCreate']

export function usePostPayment() {
  const invalidate = useInvalidatePayments()
  return useMutation({
    mutationFn: (body: PaymentCreate) => unwrap(api.POST('/api/payments', { body })),
    onSuccess: invalidate,
  })
}

export function useCancelPayment(id: number) {
  const invalidate = useInvalidatePayments()
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST('/api/payments/{payment_id}/cancel', {
          params: { path: { payment_id: id } },
          body: { reason },
        }),
      ),
    onSuccess: invalidate,
  })
}
