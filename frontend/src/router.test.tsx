import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from './api/client'
import { makeCustomer, makeProduct, makeReceipt, makeSale, ok } from './test/fixtures'
import { renderWithDataRouter } from './test/render'
import { routes } from './router'

const OWNER = { id: 1, username: 'owner', full_name: 'Владелец', role: 'owner', locale: 'ru' }

const SHORT_LISTS = new Set(['/api/products/frequent', '/api/customers/recent'])

// Every list is empty; /api/auth/me answers with the owner.
function mockApi() {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) => {
    if (path === '/api/auth/me') return ok(OWNER)
    if (SHORT_LISTS.has(path)) return ok([])
    return ok({ items: [], total: 0, sum_posted: 0 })
  }) as never)
}

/** The page's way back (ReturnLink), if it has one. */
function returnLink(): HTMLAnchorElement | null {
  return document.querySelector('a.q-return-link')
}

// Detail pages: a product, customer, sale or receipt with the same id; lists are empty.
function mockCards() {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) => {
    if (path === '/api/auth/me') return ok(OWNER)
    if (path === '/api/products/{product_id}') return ok(makeProduct())
    if (path === '/api/customers/{customer_id}') return ok(makeCustomer())
    if (path === '/api/sales/{sale_id}') return ok(makeSale())
    if (path === '/api/receipts/{receipt_id}') return ok(makeReceipt())
    return ok({ items: [], total: 0, sum_posted: 0 })
  }) as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('routes', () => {
  it.each([
    ['/sale', '/sell'],
    ['/receipts/new', '/receive'],
  ])('the old address %s opens %s', async (path, target) => {
    mockApi()
    const { router } = renderWithDataRouter(routes, { route: path })

    await waitFor(() => expect(router.state.location.pathname).toBe(target))
  })

  it('/ is the main screen', async () => {
    mockApi()
    renderWithDataRouter(routes, { route: '/' })

    expect(await screen.findByText('Здравствуйте, Владелец!')).toBeTruthy()
  })

  it.each(['/products', '/customers', '/sales', '/receipts', '/settings'])(
    '%s has «Ещё» on top',
    async (path) => {
      mockApi()
      renderWithDataRouter(routes, { route: path })

      const back = await screen.findByRole('link', { name: 'Ещё' })
      expect(back.getAttribute('href')).toBe('/more')
    },
  )

  // design-system.md, «Анатомия страницы»: one way back, a card leads to its own list.
  it.each([
    ['/products/1', 'Товары', '/products'],
    ['/customers/1', 'Покупатели', '/customers'],
    ['/sales/1', 'Продажи', '/sales'],
    ['/receipts/1', 'Приходы', '/receipts'],
  ])('%s has only «%s» as the way back', async (path, label, href) => {
    mockCards()
    renderWithDataRouter(routes, { route: path })

    const back = await screen.findByRole('link', { name: label })
    expect(back.getAttribute('href')).toBe(href)
    expect(document.querySelectorAll('a.q-return-link')).toHaveLength(1)
  })

  it.each(['/sell', '/receive', '/stock', '/more', '/'])(
    'the simple screen %s has no way back but the header',
    async (path) => {
      mockApi()
      renderWithDataRouter(routes, { route: path })

      expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
      expect(returnLink()).toBeNull()
    },
  )

  it('/more lists the detailed sections', async () => {
    mockApi()
    renderWithDataRouter(routes, { route: '/more' })

    const nav = await screen.findByRole('navigation', { name: 'Ещё' })
    const links = [...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([
      ['Товары', '/products'],
      ['Покупатели', '/customers'],
      ['История продаж', '/sales'],
      ['История приёмов', '/receipts'],
      ['Настройки', '/settings'],
    ])
  })

  it('an unknown address leads to the main screen', async () => {
    mockApi()
    renderWithDataRouter(routes, { route: '/no-such-page' })

    const home = await screen.findByRole('link', { name: 'На главную' })
    expect(home.getAttribute('href')).toBe('/')
  })
})
