import { parseMoney, validateMoneyText } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { Product } from '../products/api'
import type { ReceiptCreate } from './api'

export interface ReceiptLine {
  /** Stable id of the row on the page; the product id is not enough while rows change. */
  key: number
  product: Product
  /** NumberInput value: a number, or a string while the field is empty or being edited. */
  qty: number | string
  /** Purchase price as typed; empty means "not specified". */
  cost: string
}

export function lineHasErrors(line: ReceiptLine): boolean {
  return qtyError(line.qty) !== null || validateMoneyText(line.cost) !== null
}

/** Quantity times price in tiyn, or null when the line has no price or a bad quantity. */
export function lineTotal(line: ReceiptLine): number | null {
  const cost = parseMoney(line.cost)
  if (cost === null || qtyError(line.qty) !== null) return null
  return (line.qty as number) * cost
}

export interface ReceiptTotals {
  positions: number
  pieces: number
  /** Sum over lines that have a price. */
  cost: number
}

export function receiptTotals(lines: ReceiptLine[]): ReceiptTotals {
  let pieces = 0
  let cost = 0
  for (const line of lines) {
    if (qtyError(line.qty) === null) pieces += line.qty as number
    cost += lineTotal(line) ?? 0
  }
  return { positions: lines.length, pieces, cost }
}

export interface ReceiptHeader {
  supplier: string
  note: string
  /** ISO time in UTC, or null to let the server use the moment of posting. */
  receivedAt: string | null
}

/** Request body; a line without a price has no unit_cost at all. */
export function receiptBody(header: ReceiptHeader, lines: ReceiptLine[]): ReceiptCreate {
  return {
    supplier: header.supplier.trim() || null,
    note: header.note.trim() || null,
    received_at: header.receivedAt,
    lines: lines.map((line) => {
      const cost = parseMoney(line.cost)
      return {
        product_id: line.product.id,
        qty: line.qty as number,
        ...(cost !== null ? { unit_cost: cost } : {}),
      }
    }),
  }
}
