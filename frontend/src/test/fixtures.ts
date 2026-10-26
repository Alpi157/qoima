import type { FieldError } from '../api/errors'
import type { Customer } from '../pages/customers/api'
import type { Product } from '../pages/products/api'
import type { Receipt } from '../pages/receipts/api'
import type { Sale } from '../pages/sales/api'
import type { BusinessSettings } from '../pages/settings/api'
import type { Payment } from '../pages/payments/api'
import type { DebtAdjustment } from '../pages/debtAdjustments/api'
import type { ReturnDocument } from '../pages/returns/api'

export function makeReturn(overrides: Partial<ReturnDocument> = {}): ReturnDocument {
  return {
    id: 4,
    number: 10,
    request_id: '11111111-1111-4111-8111-111111111111',
    sale: { id: 9, number: 21 },
    customer: { id: 7, name: 'Ержан', phone: null },
    returned_at: '2026-09-28T09:00:00Z',
    total: 30000,
    debt_credit: 10000,
    refund_amount: 20000,
    refund_method: 'card',
    note: 'Не подошло',
    status: 'posted',
    cancelled_at: null,
    cancelled_by_name: null,
    cancel_reason: null,
    created_by_name: 'Владелец',
    created_at: '2026-09-28T09:00:00Z',
    lines: [
      {
        id: 21,
        sale_line_id: 11,
        product_id: 1,
        article: 'OC-90',
        name: 'Фильтр',
        unit: 'шт',
        qty: 1,
        unit_price: 10000,
        line_total: 10000,
        unit_cost: 5000,
        condition: 'good',
      },
      {
        id: 22,
        sale_line_id: 12,
        product_id: 2,
        article: 'OC-91',
        name: 'Свеча',
        unit: 'шт',
        qty: 1,
        unit_price: 20000,
        line_total: 20000,
        unit_cost: 10000,
        condition: 'defective',
      },
    ],
    ...overrides,
  }
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 3,
    number: 8,
    request_id: '11111111-1111-4111-8111-111111111111',
    customer: { id: 7, name: 'Ержан', phone: null },
    paid_at: '2026-09-27T09:00:00Z',
    amount: 100000,
    payment_method: 'cash',
    note: null,
    status: 'posted',
    cancelled_at: null,
    cancelled_by_name: null,
    cancel_reason: null,
    created_by_name: 'Владелец',
    created_at: '2026-09-27T09:00:00Z',
    ...overrides,
  }
}

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
    min_qty: null,
    avg_cost: null,
    last_cost: null,
    last_purchase_currency:
      overrides.last_cost !== undefined && overrides.last_cost !== null ? 'KZT' : null,
    last_purchase_price_minor: overrides.last_cost ?? null,
    ...overrides,
  }
}

/** openapi-fetch's success shape; the error middleware throws before callers see non-2xx. */
export function ok<T>(data: T) {
  return Promise.resolve({ data, response: new Response() }) as never
}

export function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    request_id: null,
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
    currency: 'KZT',
    exchange_rate: '1.0000',
    rate_date: null,
    rate_source: null,
    vat_payer_snapshot: false,
    expenses: [],
    goods_total: null,
    expenses_total: 0,
    vat_credit_total: 0,
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
    debt: 0,
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
    requisites: makeBusinessSettings(),
    note: null,
    status: 'posted',
    cancelled_at: null,
    cancel_reason: null,
    cancelled_by_name: null,
    created_by_name: 'Владелец',
    created_at: '2026-09-27T09:00:00Z',
    lines: [],
    total: 0,
    discount_total: null,
    paid_at_sale: 0,
    payment_method: null,
    debt_at_sale: 0,
    outstanding: 0,
    payment_status: 'returned',
    returns: [],
    ...overrides,
  }
}

export function makeBusinessSettings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    is_vat_payer: false,
    rate_warning_percent: 10,
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

export function makeStockSummary(
  overrides: Partial<import('../api/schema').components['schemas']['StockSummary']> = {},
) {
  return {
    products_count: 3,
    total_qty: 12,
    cost_value: 600000,
    retail_value: 900000,
    unknown_cost_count: 0,
    out_of_stock_count: 0,
    low_stock_count: 0,
    archived_products_count: 0,
    archived_cost_value: 0,
    ...overrides,
  }
}

export function makeReportSummary(
  overrides: Partial<import('../pages/report/api').ReportSummary> = {},
) {
  return {
    revenue: 120000,
    sales_count: 1,
    cost: 80000,
    profit: 40000,
    revenue_unknown_cost: 0,
    debt_given: 10000,
    returns_total: 0,
    returns_count: 0,
    defect_loss: 0,
    write_off_value: 0,
    write_off_count: 0,
    surplus_value: 0,
    adjustment_unknown_count: 0,
    discount_total: 0,
    discount_unknown_count: 0,
    received: { cash: 100000, card: 10000, total: 110000 },
    days: [{ date: '2026-09-27', revenue: 120000, profit: 40000 }],
    ...overrides,
  }
}

export function makeDebtAdjustment(overrides: Partial<DebtAdjustment> = {}): DebtAdjustment {
  return {
    id: 4,
    number: 10,
    request_id: '11111111-1111-4111-8111-111111111111',
    customer: { id: 7, name: 'Ержан', phone: null },
    adjusted_at: '2026-09-27T09:00:00Z',
    amount: 100000,
    reason: 'Начальный остаток',
    status: 'posted',
    cancelled_at: null,
    cancelled_by_name: null,
    cancel_reason: null,
    created_by_name: 'Владелец',
    created_at: '2026-09-27T09:00:00Z',
    ...overrides,
  }
}
