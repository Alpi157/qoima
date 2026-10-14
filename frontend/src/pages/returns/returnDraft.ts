import type { PaymentMethod } from '../../components/PaymentMethodChoice'
import type { ReturnCreate } from './api'

export type ReturnSelection = { qty: number | string; condition: 'good' | 'defective' }
export interface ReturnDraft {
  requestId: string
  openedAt: string
  selected: Record<number, ReturnSelection>
  method: PaymentMethod
  returnedAt: string | null
  note: string
  extrasOpen: boolean
  unknown: boolean
  lastBody: ReturnCreate | null
}

export function returnDraftKey(userId: number, saleId: number) {
  return `qoima.return.${userId}.${saleId}`
}

export function readReturnDraft(key: string, saleId: number): ReturnDraft | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? 'null') as ReturnDraft | null
    if (
      !raw ||
      typeof raw.requestId !== 'string' ||
      typeof raw.openedAt !== 'string' ||
      !Number.isFinite(Date.parse(raw.openedAt)) ||
      !raw.selected ||
      typeof raw.selected !== 'object'
    )
      return null
    for (const line of Object.values(raw.selected)) {
      if (
        !line ||
        (typeof line.qty !== 'number' && typeof line.qty !== 'string') ||
        !['good', 'defective'].includes(line.condition)
      )
        return null
    }
    if (
      raw.lastBody &&
      (raw.lastBody.sale_id !== saleId ||
        raw.lastBody.request_id !== raw.requestId ||
        !Array.isArray(raw.lastBody.lines))
    )
      return null
    return {
      ...raw,
      unknown: raw.unknown === true,
      method: raw.method === 'card' ? 'card' : 'cash',
      note: typeof raw.note === 'string' ? raw.note : '',
      extrasOpen: raw.extrasOpen === true,
      returnedAt: typeof raw.returnedAt === 'string' ? raw.returnedAt : null,
      lastBody: raw.lastBody ?? null,
    }
  } catch {
    return null
  }
}

export function writeReturnDraft(key: string, draft: ReturnDraft | null) {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft))
    else sessionStorage.removeItem(key)
  } catch {
    /* Keep the entered return in memory if session storage is unavailable. */
  }
}
