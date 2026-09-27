import type { Product } from '../pages/products/api'
import type { Receipt } from '../pages/receipts/api'

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    article: 'OC-90',
    article_norm: 'OC90',
    brand: null,
    name: 'Фильтр масляный',
    unit: 'шт',
    sale_price: 1250000,
    note: null,
    is_archived: false,
    created_at: '2026-09-27T09:00:00Z',
    updated_at: '2026-09-27T09:00:00Z',
    stock: 0,
    ...overrides,
  }
}

/** openapi-fetch's success shape; the error middleware throws before callers see non-2xx. */
export function ok<T>(data: T) {
  return Promise.resolve({ data, response: new Response() }) as never
}

export function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 5,
    number: 12,
    received_at: '2026-09-27T09:00:00Z',
    supplier: null,
    note: null,
    status: 'posted',
    cancelled_at: null,
    cancel_reason: null,
    created_by_name: 'Владелец',
    created_at: '2026-09-27T09:00:00Z',
    lines: [],
    total_qty: 0,
    total_cost: null,
    ...overrides,
  }
}
