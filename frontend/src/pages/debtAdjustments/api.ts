import { useMutation } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { useInvalidateDebtAdjustments } from '../../api/invalidate'
import type { components } from '../../api/schema'

export type DebtAdjustment = components['schemas']['DebtAdjustmentOut']
export type DebtAdjustmentCreate = components['schemas']['DebtAdjustmentCreate']

export function usePostDebtAdjustment() {
  const invalidate = useInvalidateDebtAdjustments()
  return useMutation({
    mutationFn: (body: DebtAdjustmentCreate) => unwrap(api.POST('/api/debt-adjustments', { body })),
    onSuccess: invalidate,
  })
}

export function useCancelDebtAdjustment(id: number) {
  const invalidate = useInvalidateDebtAdjustments()
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST('/api/debt-adjustments/{debt_adjustment_id}/cancel', {
          params: { path: { debt_adjustment_id: id } },
          body: { reason },
        }),
      ),
    onSuccess: invalidate,
  })
}
