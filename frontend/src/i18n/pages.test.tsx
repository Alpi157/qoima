import { screen } from '@testing-library/react'
import i18n from 'i18next'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { ApiError } from '../api/errors'
import { LoginPage } from '../pages/LoginPage'
import { ProductsPage } from '../pages/products/ProductsPage'
import { NewSalePage } from '../pages/sales/NewSalePage'
import { SalePage } from '../pages/sales/SalePage'
import { makeProduct, makeSale, ok } from '../test/fixtures'
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
      line_total: 3750000,
    },
  ],
  total: 3750000,
})

const KEY =
  /\b(common|nav|auth|products|customers|receipts|sales|settings|errors|validation|invoice)\.[A-Za-z]/
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
  beforeEach(async () => {
    await i18n.changeLanguage(language)
  })

  it('shows a text missing in the language as its key, not in Russian', () => {
    const texts = i18n.getResourceBundle(language, 'translation')
    i18n.removeResourceBundle(language, 'translation')
    try {
      expect(i18n.t('nav.sales')).toBe('nav.sales')
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

  it('new sale', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [], total: 0 }))
    renderWithDataRouter([{ path: '/sale', element: <NewSalePage /> }], { route: '/sale' })
    await screen.findByRole('heading', { name: i18n.t('sales.new.title') })
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
