import i18n from 'i18next'

import { unitLabel } from '../../lib/labels'
import { parseMoney, tiynToInput } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { Product } from '../products/api'
import type { SaleCreate } from '../sales/api'

export interface SaleDraftLine {
  productId: number
  /** A number, or '' while the field is empty. */
  qty: number | string
  /** The price as typed; null keeps the product's current price. */
  price: string | null
}

export interface PickedCustomer {
  id: number
  name: string
  phone: string | null
}

/** null: not chosen yet (step 2 not done); 'none': sold without a customer. */
export type SaleCustomerChoice = PickedCustomer | 'none' | null

/** The unfinished sale kept in localStorage (simple-ui.md, «Черновики»). */
export interface SaleDraft {
  version: 1
  /** One id per sale: a resend after any error, or after a reload, reuses it. */
  requestId: string
  lines: SaleDraftLine[]
  customer: SaleCustomerChoice
}

export function createSaleDraft(): SaleDraft {
  return { version: 1, requestId: crypto.randomUUID(), lines: [], customer: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseLine(value: unknown): SaleDraftLine | null {
  if (!isRecord(value) || typeof value.productId !== 'number') return null
  const qty = typeof value.qty === 'number' || typeof value.qty === 'string' ? value.qty : 1
  const price = typeof value.price === 'string' ? value.price : null
  return { productId: value.productId, qty, price }
}

function parseCustomer(value: unknown): SaleCustomerChoice {
  if (value === 'none') return 'none'
  if (isRecord(value) && typeof value.id === 'number' && typeof value.name === 'string') {
    return {
      id: value.id,
      name: value.name,
      phone: typeof value.phone === 'string' ? value.phone : null,
    }
  }
  return null
}

/** A saved draft of this version, or null (a broken or old one is dropped). */
export function parseSaleDraft(raw: unknown): SaleDraft | null {
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.requestId !== 'string') return null
  if (!Array.isArray(raw.lines)) return null
  const lines = raw.lines.map(parseLine).filter((line) => line !== null)
  return { version: 1, requestId: raw.requestId, lines, customer: parseCustomer(raw.customer) }
}

export function isSaleDraftEmpty(draft: SaleDraft): boolean {
  return draft.lines.length === 0
}

/** Adding a product that is already a line raises its quantity. */
export function addSaleLine(lines: SaleDraftLine[], productId: number): SaleDraftLine[] {
  const existing = lines.find((line) => line.productId === productId)
  if (!existing) return [...lines, { productId, qty: 1, price: null }]
  return lines.map((line) =>
    line === existing ? { ...line, qty: typeof line.qty === 'number' ? line.qty + 1 : 1 } : line,
  )
}

/** The price text of the line: as typed, or the product's current price. */
export function linePriceText(line: SaleDraftLine, product: Product): string {
  return line.price ?? tiynToInput(product.sale_price)
}

export function linePrice(line: SaleDraftLine, product: Product): number | null {
  return parseMoney(linePriceText(line, product))
}

/** Quantity times price in tiyn, or null while one of them is not valid. */
export function lineSum(line: SaleDraftLine, product: Product): number | null {
  const price = linePrice(line, product)
  if (price === null || qtyError(line.qty) !== null) return null
  return (line.qty as number) * price
}

/** What to fix in the line before going on, in the current language; null when it is fine. */
export function saleLineWarning(line: SaleDraftLine, product: Product): string | null {
  if (product.stock <= 0) return i18n.t('sell.warn.outOfStock')
  if (qtyError(line.qty) !== null) return i18n.t('flow.warn.qty')
  if ((line.qty as number) > product.stock) {
    return i18n.t('sell.warn.shortage', { stock: product.stock, unit: unitLabel(product.unit) })
  }
  if (linePrice(line, product) === null) return i18n.t('sell.warn.price')
  return null
}

export interface SaleLineView {
  line: SaleDraftLine
  product: Product
}

/** Request body: every line carries its price, even when it equals the product's price. */
export function saleBody(draft: SaleDraft, lines: SaleLineView[]): SaleCreate {
  const customer = draft.customer
  return {
    request_id: draft.requestId,
    customer_id: customer !== null && customer !== 'none' ? customer.id : null,
    lines: lines.map(({ line, product }) => ({
      product_id: product.id,
      qty: line.qty as number,
      unit_price: linePrice(line, product) as number,
    })),
  }
}
