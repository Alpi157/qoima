import { parseMoney, validateMoneyText } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { Product } from '../products/api'
import type { SaleCreate } from './api'

export const PRICE_REQUIRED = 'Укажите цену'

export interface SaleLine {
  /** Stable id of the row on the page; the product id is not enough while rows change. */
  key: number
  /** The product as last picked: its stock is what the warning compares against. */
  product: Product
  /** NumberInput value: a number, or a string while the field is empty or being edited. */
  qty: number | string
  /** Sale price as typed; starts as the product's price. */
  price: string
}

export function priceError(price: string): string | null {
  return price.trim() ? validateMoneyText(price) : PRICE_REQUIRED
}

export function lineHasErrors(line: SaleLine): boolean {
  return qtyError(line.qty) !== null || priceError(line.price) !== null
}

/** The line asks for more than the stock known when the product was picked. */
export function exceedsStock(line: SaleLine): boolean {
  return typeof line.qty === 'number' && line.qty > line.product.stock
}

/** Quantity times price in tiyn, or null while the quantity or the price is not valid. */
export function lineTotal(line: SaleLine): number | null {
  const price = parseMoney(line.price)
  if (price === null || qtyError(line.qty) !== null) return null
  return (line.qty as number) * price
}

export function saleTotal(lines: SaleLine[]): number {
  return lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0)
}

export interface SaleHeader {
  requestId: string
  customerId: number | null
  note: string
  /** ISO time in UTC, or null to let the server use the moment of posting. */
  soldAt: string | null
}

/** Request body; every line carries its price, even when it equals the product's price. */
export function saleBody(header: SaleHeader, lines: SaleLine[]): SaleCreate {
  return {
    request_id: header.requestId,
    customer_id: header.customerId,
    note: header.note.trim() || null,
    ...(header.soldAt !== null ? { sold_at: header.soldAt } : {}),
    lines: lines.map((line) => ({
      product_id: line.product.id,
      qty: line.qty as number,
      unit_price: parseMoney(line.price) as number,
    })),
  }
}
