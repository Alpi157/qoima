// Limits match the backend schemas (document lines, adjustments, cancellation reasons).

export const MAX_LINE_QTY = 100_000

export const QTY_ERROR = 'Целое число от 1 до 100 000'

/** A line or adjustment quantity: a whole number from 1 to MAX_LINE_QTY. */
export function qtyError(qty: number | string): string | null {
  return typeof qty === 'number' && Number.isInteger(qty) && qty >= 1 && qty <= MAX_LINE_QTY
    ? null
    : QTY_ERROR
}

export const MIN_REASON_LENGTH = 3

export const REASON_ERROR = 'Укажите причину, не короче 3 символов'

/** Reason for a cancellation or an adjustment; spaces around it do not count. */
export function reasonError(reason: string): string | null {
  return reason.trim().length < MIN_REASON_LENGTH ? REASON_ERROR : null
}
