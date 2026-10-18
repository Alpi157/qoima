import { screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import { PurchaseHistory } from './PurchaseHistory'
import type { ProductPurchase } from './api'

afterEach(() => vi.restoreAllMocks())
it('pages purchase history independently, uses the unit and links to the receipt', async () => {
  const items: ProductPurchase[] = Array.from({ length: 51 }, (_, i) => ({
    receipt_id: i + 1,
    receipt_number: i + 10,
    received_at: '2026-10-01T10:00:00Z',
    currency: 'CNY',
    exchange_rate: '67.6200',
    unit_price_minor: 10000,
    qty: 2,
    unit_cost: 781200,
    total: 1562400,
  }))
  vi.spyOn(api, 'GET').mockImplementation(((
    _path: string,
    init: { params: { query: { offset: number; limit: number } } },
  ) =>
    ok({
      items: items.slice(
        init.params.query.offset,
        init.params.query.offset + init.params.query.limit,
      ),
      total: items.length,
    })) as never)
  const { router } = renderWithDataRouter(
    [
      { path: '/products/:id', element: <PurchaseHistory productId={1} unit="л" /> },
      { path: '/receipts/:id', element: <p>Receipt</p> },
    ],
    { route: '/products/1?page=2' },
  )
  await screen.findByRole('table')
  expect(screen.getAllByText('2 л').length).toBeGreaterThan(0)
  await setupUser().click(screen.getByRole('button', { name: 'Следующая страница' }))
  await waitFor(() => expect(router.state.location.search).toBe('?page=2&purchasesPage=2'))
  await waitFor(() =>
    expect(screen.getAllByRole('link')[0].getAttribute('href')).toBe('/receipts/51'),
  )
  await setupUser().click(screen.getAllByRole('link')[0])
  await screen.findByText('Receipt')
})
