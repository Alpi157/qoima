import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { makeProduct, makeStockSummary, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import { StockPage } from './StockPage'

const IN_STOCK = makeProduct({ id: 1, article: 'IKH16TT', name: 'Свеча', stock: 12 })
const EMPTY = makeProduct({ id: 2, article: 'L3Y4', name: 'Свеча Mazda', stock: 0 })

interface ListInit {
  params: { query: { q?: string } }
}

function renderStock(route = '/stock') {
  return renderWithDataRouter(
    [
      { path: '/stock', element: <StockPage /> },
      { path: '/products/:id', element: <h1>Карточка</h1> },
    ],
    { route },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StockPage', () => {
  it('shows quantities and a warning badge when nothing is left', async () => {
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(
        path === '/api/stock/summary' ? makeStockSummary() : { items: [IN_STOCK, EMPTY], total: 2 },
      )) as never)
    renderStock()

    expect(await screen.findByRole('heading', { name: 'Что есть на складе?' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Принять товар' }).getAttribute('href')).toBe(
      '/receive',
    )
    expect((await screen.findAllByText('12 шт')).length).toBeGreaterThan(0)
    const none = screen.getAllByText('Закончились')[0]
    expect(none.closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning')
  })

  it('searches by the typed text and keeps it in the address', async () => {
    const user = setupUser()
    const get = vi
      .spyOn(api, 'GET')
      .mockImplementation(((path: string) =>
        ok(
          path === '/api/stock/summary' ? makeStockSummary() : { items: [IN_STOCK], total: 1 },
        )) as never)
    const { router } = renderStock()

    await fill(
      user,
      await screen.findByRole('searchbox', { name: 'Поиск по артикулу или названию' }),
      'ikh',
    )
    await waitFor(() => expect(router.state.location.search).toBe('?q=ikh'))
    const queries = () =>
      get.mock.calls
        .filter((call) => call[0] === '/api/products')
        .map((call) => (call[1] as unknown as ListInit).params.query.q)
    await waitFor(() => expect(queries()).toContain('ikh'))
  })

  it('a row opens the product card', async () => {
    const user = setupUser()
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      ok(
        path === '/api/stock/summary' ? makeStockSummary() : { items: [IN_STOCK], total: 1 },
      )) as never)
    const { router } = renderStock()

    await user.click((await screen.findAllByText('Свеча'))[0])
    expect(router.state.location.pathname).toBe('/products/1')
  })
})

it.each(['out', 'low'])(
  'reads %s from URL and clears the filter while preserving search',
  async (state) => {
    const user = setupUser()
    const get = vi
      .spyOn(api, 'GET')
      .mockImplementation(((path: string) =>
        ok(
          path === '/api/stock/summary'
            ? makeStockSummary({ out_of_stock_count: 4, low_stock_count: 2, unknown_cost_count: 1 })
            : { items: [IN_STOCK], total: 1 },
        )) as never)
    const { router } = renderStock(`/stock?state=${state}&q=IKH&page=2`)
    const button = await screen.findByRole('button', {
      name: state === 'out' ? 'Закончились (4)' : 'Заканчиваются (2)',
    })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(get).toHaveBeenCalledWith(
      '/api/products',
      expect.objectContaining({
        params: { query: expect.objectContaining({ stock_state: state, q: 'IKH', offset: 50 }) },
      }),
    )
    await user.click(button)
    expect(router.state.location.search).toBe('?q=IKH')
    expect(screen.getByText('Товары без закупочной цены: 1')).toBeTruthy()
    expect(screen.getByText('По закупочной цене')).toBeTruthy()
  },
)

it('uses low-stock warning badges only for positive stock at or below the threshold', async () => {
  const items = [
    makeProduct({ id: 1, article: 'A', stock: 0, min_qty: 5 }),
    makeProduct({ id: 2, article: 'B', stock: 2, min_qty: 2, avg_cost: 0 }),
    makeProduct({ id: 3, article: 'C', stock: 3, min_qty: 2 }),
  ]
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    ok(path === '/api/stock/summary' ? makeStockSummary() : { items, total: 3 })) as never)
  renderStock()
  await screen.findByRole('table')
  const badges = document.querySelectorAll('[data-tone="warning"]')
  expect([...badges].map((badge) => badge.textContent)).toEqual([
    'Закончились',
    'Заканчиваются',
    'Закончились',
    'Заканчиваются',
  ])
})

it('rounds stock values and average cost, leaving the sale price exact', async () => {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    ok(
      path === '/api/stock/summary'
        ? makeStockSummary({ cost_value: 648750, retail_value: 6940881 })
        : { items: [makeProduct({ avg_cost: 68750, sale_price: 150005 })], total: 1 },
    )) as never)
  renderStock()
  const table = await screen.findByRole('table')
  expect(within(table).getByRole('columnheader', { name: 'Цена продажи' })).toBeTruthy()
  expect(within(table).getByText('688 ₸')).toBeTruthy()
  expect(within(table).getByText('1 500,05 ₸')).toBeTruthy()
  expect(screen.getByText('6 488')).toBeTruthy()
  expect(screen.getByText('69 409')).toBeTruthy()
})
