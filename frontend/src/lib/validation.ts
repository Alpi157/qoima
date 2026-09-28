import i18n from 'i18next'

// Limits match the backend schemas (document lines, adjustments, cancellation reasons).

export const MAX_LINE_QTY = 100_000

/** "Целое число от 1 до 100 000" in the current language. */
export function qtyErrorText(): string {
  return i18n.t('common.input.qtyRange')
}

/** A line or adjustment quantity: a whole number from 1 to MAX_LINE_QTY. */
export function qtyError(qty: number | string): string | null {
  return typeof qty === 'number' && Number.isInteger(qty) && qty >= 1 && qty <= MAX_LINE_QTY
    ? null
    : qtyErrorText()
}

export const MIN_REASON_LENGTH = 3

/** Reason for a cancellation or an adjustment; spaces around it do not count. */
export function reasonError(reason: string): string | null {
  return reason.trim().length < MIN_REASON_LENGTH
    ? i18n.t('common.input.reasonTooShort', { count: MIN_REASON_LENGTH })
    : null
}
