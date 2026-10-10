import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { makeProduct, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { ProductPage } from './ProductPage'
afterEach(() => vi.restoreAllMocks())
it('translates return movements and links both to the return document', async () => {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    ok(
      path === '/api/products/{product_id}'
        ? makeProduct()
        : {
            items: ['return', 'return_cancel'].map((kind, i) => ({
              id: i + 1,
              created_at: '2026-09-27T09:00:00Z',
              kind,
              qty: i ? -1 : 1,
              balance_after: 1,
              doc_type: 'return',
              doc_id: 4,
              doc_number: 10,
              created_by_name: 'Владелец',
              note: null,
            })),
            total: 2,
          },
    )) as never)
  renderWithDataRouter([{ path: '/products/:id', element: <ProductPage /> }], {
    route: '/products/1',
  })
  await screen.findByRole('table')
  expect(screen.getAllByText('Возврат').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Отмена возврата').length).toBeGreaterThan(0)
  for (const link of screen.getAllByRole('link', { name: '№ 10' }))
    expect(link.getAttribute('href')).toBe('/returns/4')
})
it.each([null, 0, 100050])('shows costs %s and an explicit unset threshold', async (cost) => {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    ok(
      path === '/api/products/{product_id}'
        ? makeProduct({ avg_cost: cost, last_cost: cost })
        : { items: [], total: 0 },
    )) as never)
  renderWithDataRouter([{ path: '/products/:id', element: <ProductPage /> }], {
    route: '/products/1',
  })
  await screen.findByText('Средняя закупочная цена')
  expect(screen.getByText('Последняя закупочная цена')).toBeTruthy()
  expect(screen.getByText('Не задано')).toBeTruthy()
  if (cost === null) expect(screen.getAllByText('Неизвестно')).toHaveLength(2)
  else expect(screen.queryByText('Неизвестно')).toBeNull()
})

it('rounds only average cost, preserving last cost and the sale price', async () => {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    ok(
      path === '/api/products/{product_id}'
        ? makeProduct({ avg_cost: 68750, last_cost: 90050, sale_price: 150005 })
        : { items: [], total: 0 },
    )) as never)
  renderWithDataRouter([{ path: '/products/:id', element: <ProductPage /> }], {
    route: '/products/1',
  })
  await screen.findByText('Средняя закупочная цена')
  expect(screen.getByText('Цена продажи')).toBeTruthy()
  expect(screen.getByText('688')).toBeTruthy()
  expect(screen.getByText('900,50')).toBeTruthy()
  expect(screen.getByText('1 500,05')).toBeTruthy()
})
