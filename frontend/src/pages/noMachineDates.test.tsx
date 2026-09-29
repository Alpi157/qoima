import { screen } from '@testing-library/react'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Language } from '../i18n/language'
import { makeCustomer, makeProduct, makeReceipt, makeSale, ok } from '../test/fixtures'
import { renderWithDataRouter } from '../test/render'
import { CustomerPage } from './customers/CustomerPage'
import { ProductPage } from './products/ProductPage'
import { ReceiptPage } from './receipts/ReceiptPage'
import { ReceiptsPage } from './receipts/ReceiptsPage'
import { SalePage } from './sales/SalePage'
import { SalesPage } from './sales/SalesPage'

// design-system.md, «Даты»: only «27.09.2026» and «27.09.2026 15:44» on screen, never the
// machine format «2026-09-27», in any language.
const MACHINE_DATE = /\b\d{4}-\d{2}-\d{2}\b/
const MOMENT = '2026-09-27T09:44:00Z'

const SALE = makeSale({
  sold_at: MOMENT,
  created_at: MOMENT,
  status: 'cancelled',
  cancelled_at: MOMENT,
  cancelled_by_name: 'Владелец',
  cancel_reason: 'Ошибка',
})
const RECEIPT = makeReceipt({ received_at: MOMENT, created_at: MOMENT })
const SALE_ITEM = {
  id: 9,
  number: 21,
  sold_at: MOMENT,
  customer_id: 7,
  customer_name: 'Ержан',
  lines_count: 1,
  total_qty: 2,
  total: 250000,
  status: 'posted',
}
const RECEIPT_ITEM = {
  id: 5,
  number: 12,
  received_at: MOMENT,
  supplier: 'Склад',
  lines_count: 1,
  total_qty: 2,
  total_cost: null,
  status: 'posted',
}
const MOVEMENT = {
  id: 1,
  created_at: MOMENT,
  kind: 'receipt',
  doc_type: 'receipt',
  doc_id: 5,
  doc_number: 12,
  qty: 2,
  balance_after: 2,
  created_by_name: 'Владелец',
  note: null,
}

function mockApi() {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) => {
    switch (path) {
      case '/api/sales':
        return ok({ items: [SALE_ITEM], total: 1, sum_posted: 250000 })
      case '/api/sales/{sale_id}':
        return ok(SALE)
      case '/api/receipts':
        return ok({ items: [RECEIPT_ITEM], total: 1 })
      case '/api/receipts/{receipt_id}':
        return ok(RECEIPT)
      case '/api/products/{product_id}':
        return ok(makeProduct({ created_at: MOMENT, updated_at: MOMENT }))
      case '/api/products/{product_id}/movements':
        return ok({ items: [MOVEMENT], total: 1 })
      case '/api/customers/{customer_id}':
        return ok(makeCustomer({ created_at: MOMENT }))
      default:
        throw new Error(`unexpected GET ${path}`)
    }
  }) as never)
}

const SCREENS: [string, string, string, ReactNode][] = [
  ['sales', '/sales', '/sales', <SalesPage />],
  ['sale', '/sales/:id', '/sales/9', <SalePage />],
  ['receipts', '/receipts', '/receipts', <ReceiptsPage />],
  ['receipt', '/receipts/:id', '/receipts/5', <ReceiptPage />],
  ['product', '/products/:id', '/products/1', <ProductPage />],
  ['customer', '/customers/:id', '/customers/7', <CustomerPage />],
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each<Language>(['ru', 'kk', 'zh'])('dates on screen in %s', (language) => {
  it.each(SCREENS)('%s shows no machine dates', async (_name, path, route, element) => {
    await i18n.changeLanguage(language)
    mockApi()
    renderWithDataRouter([{ path, element }], { route })

    // Every screen here shows the moment at least once.
    const shown = language === 'zh' ? '2026/09/27' : '27.09.2026'
    expect((await screen.findAllByText(new RegExp(shown))).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(MACHINE_DATE)
  })
})
