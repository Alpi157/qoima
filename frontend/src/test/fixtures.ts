import type { FieldError } from '../api/errors'
import type { Customer } from '../pages/customers/api'
import type { Product } from '../pages/products/api'
import type { Receipt } from '../pages/receipts/api'
import type { Sale } from '../pages/sales/api'
import type { BusinessSettings } from '../pages/settings/api'

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
    cancelled_by_name: null,
    created_by_name: 'Владелец',
    created_at: '2026-09-27T09:00:00Z',
    lines: [],
    total_qty: 0,
    total_cost: null,
    ...overrides,
  }
}

export function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 7,
    name: 'Ержан',
    phone: '+7 701 123 45 67',
    note: null,
    created_at: '2026-09-27T09:00:00Z',
    ...overrides,
  }
}

export function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 9,
    number: 21,
    request_id: '00000000-0000-4000-8000-000000000000',
    sold_at: '2026-09-27T09:00:00Z',
    customer: null,
    note: null,
    status: 'posted',
    cancelled_at: null,
    cancel_reason: null,
    cancelled_by_name: null,
    created_by_name: 'Владелец',
    created_at: '2026-09-27T09:00:00Z',
    lines: [],
    total: 0,
    ...overrides,
  }
}

export function makeBusinessSettings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    seller_name: '3А Аuto Parts.KZ',
    seller_iin_bin: '900101300123',
    responsible_person: 'Кәкеш Арман',
    released_by_name: 'Кәкеш А.',
    chief_accountant: 'Қамтамасыз етілмейді',
    updated_at: '2026-09-27T09:00:00Z',
    ...overrides,
  }
}

/** An item of the validation `errors` list, as the backend sends it. */
export function fieldError(
  message: string,
  type = '',
  params: Record<string, unknown> = {},
): FieldError {
  return { message, type, params }
}
