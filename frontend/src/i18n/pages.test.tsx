import { screen } from '@testing-library/react'
import i18n from 'i18next'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { ApiError } from '../api/errors'
import { ReportPage } from '../pages/report/ReportPage'
import { HomePage } from '../pages/home/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { MorePage } from '../pages/more/MorePage'
import { ProductsPage } from '../pages/products/ProductsPage'
import { SalePage } from '../pages/sales/SalePage'
import { SellPage } from '../pages/sell/SellPage'
import { StockPage } from '../pages/stock/StockPage'
import { ReceivePage } from '../pages/receive/ReceivePage'
import { DebtsPage } from '../pages/debts/DebtsPage'
import { CustomerPage } from '../pages/customers/CustomerPage'
import { PaymentModal } from '../pages/payments/PaymentModal'
import {
  makeCustomer,
  makeProduct,
  makeSale,
  makeStockSummary,
  makeReportSummary,
  ok,
} from '../test/fixtures'
import { renderWithDataRouter, renderWithProviders } from '../test/render'
import type { Language } from './language'

// Data in Latin letters: on the Chinese screens any Cyrillic then comes from the interface.
const PRODUCT = makeProduct({ name: 'Oil filter', stock: 4, unit: 'шт' })
const SALE = makeSale({
  customer: { id: 7, name: 'Erzhan', phone: '+7 701 123 45 67' },
  created_by_name: 'Owner',
  lines: [
    {
      product_id: 1,
      article: 'OC-90',
      name: 'Oil filter',
      unit: 'шт',
      qty: 3,
      unit_price: 1250000,
      id: 1,
      returned_qty: 0,
      unit_cost: null,
      line_total: 3750000,
    },
  ],
  total: 3750000,
})

const KEY =
  /\b(common|nav|home|more|auth|products|customers|debts|payments|receipts|sales|sell|receive|flow|settings|errors|validation|invoice|stock|report|paymentMethod)\.[A-Za-z]/
const ATTRIBUTES = ['aria-label', 'placeholder', 'title', 'alt']

/**
 * Texts the user sees or hears: text nodes and labelling attributes. Styles are skipped, and
 * so are parts marked with another language (the language switcher says «Русский»).
 */
function pageTexts(language: Language): string[] {
  const inLanguage = (element: Element | null) =>
    element !== null && (element.closest('[lang]')?.getAttribute('lang') ?? language) === language
  const texts: string[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent?.closest('style, script') || !inLanguage(parent)) continue
    if (node.textContent?.trim()) texts.push(node.textContent)
  }
  for (const element of document.body.querySelectorAll('*')) {
    if (!inLanguage(element)) continue
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name)
      if (value) texts.push(value)
    }
  }
  return texts
}

function expectTranslated(language: Language) {
  const texts = pageTexts(language)
  expect(texts.filter((text) => KEY.test(text))).toStrictEqual([])
  if (language === 'zh') expect(texts.filter((text) => /[А-Яа-яЁё]/.test(text))).toStrictEqual([])
}

// Without the fallback a key missing in kk.json or zh.json shows as the key itself,
// instead of the Russian text.
beforeEach(() => {
  i18n.options.fallbackLng = false
})

afterEach(() => {
  i18n.options.fallbackLng = 'ru'
  vi.restoreAllMocks()
})

describe.each<Language>(['kk', 'zh'])('pages in %s', (language) => {
  it('debt list', async () => {
    const customer = makeCustomer({ name: 'Customer', debt: 100000 })
    vi.spyOn(api, 'GET').mockReturnValue(
      ok({ items: [customer], total: 1, total_debt: 100000, debtors_count: 1 }),
    )
    renderWithProviders(<DebtsPage />)
    await screen.findByRole('table')
    expectTranslated(language)
  })

  it('customer debt and payment form', async () => {
    const customer = makeCustomer({ name: 'Customer', debt: 100000 })
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(
        path === '/api/customers/{customer_id}' ? customer : { items: [], total: 0, sum_posted: 0 },
      )) as never)
    const rendered = renderWithDataRouter([{ path: '/customers/:id', element: <CustomerPage /> }], {
      route: '/customers/7',
    })
    await screen.findByRole('button', { name: i18n.t('payments.title') })
    expectTranslated(language)
    rendered.unmount()
    renderWithProviders(<PaymentModal customer={customer} opened onClose={() => {}} />)
    await screen.findByRole('textbox', { name: i18n.t('payments.amount') })
    expectTranslated(language)
  })
  beforeEach(async () => {
    await i18n.changeLanguage(language)
  })

  it('shows a text missing in the language as its key, not in Russian', () => {
    const texts = i18n.getResourceBundle(language, 'translation')
    i18n.removeResourceBundle(language, 'translation')
    try {
      expect(i18n.t('more.sales')).toBe('more.sales')
    } finally {
      i18n.addResourceBundle(language, 'translation', texts)
    }
  })

  it('login', async () => {
    vi.spyOn(api, 'GET').mockRejectedValue(new ApiError(401, 'Требуется вход'))
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      { route: '/login' },
    )
    await screen.findByRole('button', { name: i18n.t('auth.login.submit') })
    expectTranslated(language)
  })

  it('main screen', async () => {
    const owner = { id: 1, username: 'owner', full_name: 'Arman', role: 'owner', locale: language }
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(
        path === '/api/auth/me'
          ? owner
          : path === '/api/stock/summary'
            ? makeStockSummary({ out_of_stock_count: 2, low_stock_count: 1 })
            : { items: [], total: 2, sum_posted: 3840000 },
      )) as never)
    renderWithDataRouter([{ path: '/', element: <HomePage /> }], { route: '/' })
    await screen.findByTestId('today-sales')
    expectTranslated(language)
  })

  it('more', async () => {
    renderWithProviders(<MorePage />)
    await screen.findByRole('navigation')
    expectTranslated(language)
  })

  it('sale, step 1', async () => {
    const owner = { id: 1, username: 'owner', full_name: 'Arman', role: 'owner', locale: language }
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(path === '/api/auth/me' ? owner : [PRODUCT])) as never)
    renderWithDataRouter([{ path: '/sell', element: <SellPage /> }], { route: '/sell' })
    await screen.findByRole('heading', { name: i18n.t('sell.products.title') })
    await screen.findByRole('button', { name: i18n.t('flow.addOf', { article: PRODUCT.article }) })
    expectTranslated(language)
  })

  it('receiving', async () => {
    const owner = { id: 1, username: 'owner', full_name: 'Arman', role: 'owner', locale: language }
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(path === '/api/auth/me' ? owner : { items: [], total: 0 })) as never)
    renderWithDataRouter([{ path: '/receive', element: <ReceivePage /> }], { route: '/receive' })
    await screen.findByRole('heading', { name: i18n.t('receive.title') })
    expectTranslated(language)
  })

  it('stock, with the unit in the interface language', async () => {
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(
        path === '/api/stock/summary' ? makeStockSummary() : { items: [PRODUCT], total: 1 },
      )) as never)
    renderWithProviders(<StockPage />, { route: '/stock' })
    expect((await screen.findAllByText('Oil filter')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(`4 ${i18n.t('common.units.pcs')}`).length).toBeGreaterThan(0)
    expectTranslated(language)
  })

  it('report', async () => {
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(
        path === '/api/reports/summary'
          ? makeReportSummary({ revenue_unknown_cost: 1000 })
          : { items: [], total: 0 },
      )) as never)
    renderWithProviders(<ReportPage />, { route: '/report?from=2026-09-01&to=2026-09-30' })
    await screen.findByTestId('report-profit')
    expectTranslated(language)
  })

  it('product list, with the unit in the interface language', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [PRODUCT], total: 1 }))
    renderWithProviders(<ProductsPage />, { route: '/products' })
    expect((await screen.findAllByText('Oil filter')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(`4 ${i18n.t('common.units.pcs')}`).length).toBeGreaterThan(0)
    expectTranslated(language)
  })

  it('sale card', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(SALE))
    renderWithDataRouter([{ path: '/sales/:id', element: <SalePage /> }], {
      route: '/sales/9',
    })
    expect((await screen.findAllByText('Oil filter')).length).toBeGreaterThan(0)
    expectTranslated(language)
  })
})
