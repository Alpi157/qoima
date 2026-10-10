import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { makeProduct, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { ProductPage } from './ProductPage'
afterEach(() => vi.restoreAllMocks())
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
