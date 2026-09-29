import { qtyError } from '../../lib/validation'
import { lineSum, type SaleLineView } from './saleDraft'

export interface SaleTotals {
  kinds: number
  /** Pieces over the lines with a valid quantity. */
  qty: number
  /** Tiyn over the lines with a valid quantity and price. */
  sum: number
}

export function saleTotals(views: SaleLineView[]): SaleTotals {
  return views.reduce(
    (totals, { line, product }) => ({
      kinds: totals.kinds + 1,
      qty: totals.qty + (qtyError(line.qty) === null ? (line.qty as number) : 0),
      sum: totals.sum + (lineSum(line, product) ?? 0),
    }),
    { kinds: 0, qty: 0, sum: 0 },
  )
}
