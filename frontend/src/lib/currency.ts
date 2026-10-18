import type { components } from '../api/schema'
import { formatAmount } from './money'

export type Currency = NonNullable<components['schemas']['ReceiptCreate']['currency']>
export const CURRENCIES: Currency[] = ['KZT', 'CNY', 'USD']
export const CURRENCY_SYMBOL: Record<Currency, string> = { KZT: '₸', CNY: '¥', USD: '$' }

/** Rates remain strings; arithmetic uses scaled integers. */
export function parseRate(text: string): string | null {
  const value = text.trim().replace(',', '.')
  if (!/^\d{1,8}(?:\.\d{1,4})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0')) > 0n ? value : null
}
export function rateScaled(text: string): bigint | null {
  const parsed = parseRate(text)
  if (parsed === null) return null
  const [whole, fraction = ''] = parsed.split('.')
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))
}
export function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator)
}
export function convertMinor(amount: number | bigint, rate: string): bigint | null {
  const scaled = rateScaled(rate)
  return scaled === null ? null : halfUp(BigInt(amount) * scaled, 10000n)
}
export function formatCurrency(amount: number | bigint, currency: Currency): string {
  return `${formatAmount(amount)}\u00a0${CURRENCY_SYMBOL[currency]}`
}
export function displayRate(rate: string): string {
  return rate.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}
