const NBSP = '\u00a0'
const TIYN_PER_TENGE = 100

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** 1250000 -> "12 500 ₸", 1250050 -> "12 500,50 ₸" (non-breaking spaces). */
export function formatMoney(tiyn: number): string {
  const sign = tiyn < 0 ? '-' : ''
  const abs = Math.abs(tiyn)
  const tenge = Math.floor(abs / TIYN_PER_TENGE)
  const rest = abs % TIYN_PER_TENGE
  const fraction = rest === 0 ? '' : ',' + String(rest).padStart(2, '0')
  return `${sign}${groupThousands(String(tenge))}${fraction}${NBSP}₸`
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
