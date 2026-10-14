import { useState } from 'react'
import { type ApiError, isApiError, isServerOrNetworkError } from '../../api/errors'

const CONFLICT_CODES = new Set([
  'sale_request_conflict',
  'receipt_request_conflict',
  'payment_request_conflict',
  'return_request_conflict',
  'debt_adjustment_request_conflict',
  'stock_adjustment_request_conflict',
])

export function isRequestConflict(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 409 && CONFLICT_CODES.has(error.code ?? '')
}

export function useDocumentResult() {
  const [unknown, setUnknown] = useState(false)
  const [conflict, setConflict] = useState<ApiError | null>(null)
  const acceptError = (error: unknown) => {
    setUnknown(isServerOrNetworkError(error))
    setConflict(isRequestConflict(error) ? error : null)
    return isServerOrNetworkError(error) || isRequestConflict(error)
  }
  return { unknown, conflict, acceptError }
}
