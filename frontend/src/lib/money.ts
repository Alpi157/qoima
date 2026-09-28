import i18n from 'i18next'

const NBSP = '\u00a0'
const TIYN_PER_TENGE = 100

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** 1250000 -> "12 500", 1250050 -> "12 500,50": tiyn only when there are any, no currency sign. */
export function formatAmount(tiyn: number): string {
  const sign = tiyn < 0 ? '-' : ''
  const abs = Math.abs(tiyn)
  const tenge = Math.floor(abs / TIYN_PER_TENGE)
  const rest = abs % TIYN_PER_TENGE
  const fraction = rest === 0 ? '' : ',' + String(rest).padStart(2, '0')
  return `${sign}${groupThousands(String(tenge))}${fraction}`
}

/** 1250000 -> "12 500 ₸", 1250050 -> "12 500,50 ₸" (non-breaking spaces). */
export function formatMoney(tiyn: number): string {
  return `${formatAmount(tiyn)}${NBSP}₸`
}

/** 1250 -> "1 250": a whole number such as a quantity, thousands grouped. */
export function formatInteger(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}${groupThousands(String(Math.abs(value)))}`
}

const MONEY_PATTERN = /^(\d+)(?:[.,](\d{1,2}))?$/

/** "12 500", "12500,5", "12500.50" -> tiyn. Negative, malformed or empty input -> null. */
export function parseMoney(input: string): number | null {
  const compact = input.trim().replace(/[\s\u00a0\u202f]/g, '')
  const match = MONEY_PATTERN.exec(compact)
  if (!match) return null
  const [, tenge, fraction = ''] = match
  const tiyn = Number(tenge) * TIYN_PER_TENGE + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(tiyn) ? tiyn : null
}

/** 1250000 -> "12500", 1250050 -> "12500,50": the tiyn value as the user would type it. */
export function tiynToInput(tiyn: number): string {
  const tenge = Math.floor(tiyn / TIYN_PER_TENGE)
  const rest = tiyn % TIYN_PER_TENGE
  return rest === 0 ? String(tenge) : `${tenge},${String(rest).padStart(2, '0')}`
}

/** Validator for a typed amount: empty is allowed, the caller decides if it is required. */
export function validateMoneyText(text: string): string | null {
  return text.trim() && parseMoney(text) === null ? i18n.t('common.input.moneyFormat') : null
}
