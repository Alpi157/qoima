import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import type { SaleListItem } from './api'
import { SalesPage } from './SalesPage'

const POSTED: SaleListItem = {
  id: 9,
  number: 21,
  sold_at: '2026-09-27T09:00:00Z',
  customer_name: 'Ержан',
  status: 'posted',
  lines_count: 2,
  total_qty: 3,
  total: 3750000,
}
const CANCELLED: SaleListItem = { ...POSTED, id: 8, number: 20, status: 'cancelled' }

function mockSales() {
  return vi
    .spyOn(api, 'GET')
    .mockReturnValue(ok({ items: [POSTED, CANCELLED], total: 2, sum_posted: 3750000 }))
}

function renderPage(route = '/sales') {
  return renderWithDataRouter(
    [
      { path: '/sales', element: <SalesPage /> },
      { path: '/sales/:id', element: <p>Карточка продажи</p> },
    ],
    { route },
  )
}

function lastQuery(get: ReturnType<typeof mockSales>) {
  const init = get.mock.calls.at(-1)?.[1] as unknown as {
    params: { query: Record<string, unknown> }
  }
  return init.params.query
}

beforeEach(() => {
  // Sunday 27.09.2026 00:30 in Astana, while UTC is still Saturday 26.09.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-26T19:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SalesPage', () => {
  it('shows the posted total for the period and the number of sales', async () => {
    mockSales()
    renderPage()

    expect(await screen.findByText('Итого за период: 37 500 ₸')).toBeTruthy()
    expect(screen.getByText('Продаж: 2')).toBeTruthy()
    expect(screen.getAllByText('Ержан').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Отменена').length).toBeGreaterThan(0)
  })

  it.each([
    ['Сегодня', '2026-09-27', '2026-09-27'],
    ['Неделя', '2026-09-21', '2026-09-27'],
    ['Месяц', '2026-09-01', '2026-09-27'],
  ])('"%s" sets the period by Astana time', async (label, from, to) => {
    const user = userEvent.setup()
    const get = mockSales()
    const { router } = renderPage()

    await screen.findByText('Продаж: 2')
    await user.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(router.state.location.search).toBe(`?from=${from}&to=${to}`))
    await waitFor(() => expect(lastQuery(get)).toMatchObject({ date_from: from, date_to: to }))
  })

  it('reads the filters from the address', async () => {
    const get = mockSales()
    renderPage('/sales?from=2026-09-01&to=2026-09-27&status=posted')

    await screen.findByText('Продаж: 2')
    expect(get).toHaveBeenCalledWith('/api/sales', {
      params: {
        query: {
          date_from: '2026-09-01',
          date_to: '2026-09-27',
          customer_id: undefined,
          status: 'posted',
          limit: 50,
          offset: 0,
        },
      },
    })
  })
})
