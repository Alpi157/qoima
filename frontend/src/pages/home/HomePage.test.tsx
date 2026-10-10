import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { todayLocal } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { makeStockSummary, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import { HomePage } from './HomePage'

const OWNER = { id: 1, username: 'owner', full_name: 'Арман', role: 'owner', locale: 'ru' }

function mockApi(
  today: { total: number; sum_posted: number },
  totalDebt = 0,
  stock = makeStockSummary(),
) {
  return vi
    .spyOn(api, 'GET')
    .mockImplementation(((path: string) =>
      ok(
        path === '/api/auth/me'
          ? OWNER
          : path === '/api/stock/summary'
            ? stock
            : path === '/api/customers/debts'
              ? { items: [], total: 0, total_debt: totalDebt, debtors_count: 0 }
              : { items: [], ...today },
      )) as never)
}

function renderHome() {
  return renderWithDataRouter(
    [
      { path: '/', element: <HomePage /> },
      { path: '/more', element: <p>Экран «Ещё»</p> },
      { path: '*', element: <p>Другой экран</p> },
    ],
    { route: '/' },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HomePage', () => {
  it('hides the debt link at zero and requests only one item', async () => {
    const get = mockApi({ total: 0, sum_posted: 0 })
    renderHome()
    await screen.findByTestId('today-sales')
    expect(screen.queryByTestId('home-debts')).toBeNull()
    expect(get).toHaveBeenCalledWith('/api/customers/debts', { params: { query: { limit: 1 } } })
  })

  it('links the total debt to /debts with the amount in bold', async () => {
    mockApi({ total: 0, sum_posted: 0 }, 1234500)
    renderHome()
    const link = await screen.findByTestId('home-debts')
    expect(link.getAttribute('href')).toBe('/debts')
    expect(link.querySelector('b')?.textContent).toBe(formatMoney(1234500))
  })
  it('greets the user by name', async () => {
    mockApi({ total: 0, sum_posted: 0 })
    renderHome()

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Арман!' })).toBeTruthy()
    expect(screen.getByText('Что делаем?')).toBeTruthy()
  })

  it('tiles lead to selling, receiving and the stock', async () => {
    mockApi({ total: 0, sum_posted: 0 })
    renderHome()

    const sell = await screen.findByRole('link', { name: /Продать/ })
    expect(sell.getAttribute('href')).toBe('/sell')
    expect(sell.textContent).toContain('Продать товар и выписать накладную')
    expect(screen.getByRole('link', { name: /Принять товар/ }).getAttribute('href')).toBe(
      '/receive',
    )
    expect(screen.getByRole('link', { name: /Что есть на складе\?/ }).getAttribute('href')).toBe(
      '/stock',
    )
  })

  it("shows the number and the sum of today's posted sales", async () => {
    const get = mockApi({ total: 3, sum_posted: 3840000 })
    renderHome()

    await waitFor(() =>
      expect(screen.getByTestId('today-sales').textContent).toBe(
        `Сегодня: 3 продажи, всего ${formatMoney(3840000)}`,
      ),
    )
    const today = todayLocal()
    expect(get).toHaveBeenCalledWith('/api/sales', {
      params: {
        query: expect.objectContaining({ date_from: today, date_to: today, status: 'posted' }),
      },
    })
  })

  it('uses the plural form of the count', async () => {
    mockApi({ total: 1, sum_posted: 1250000 })
    renderHome()

    await waitFor(() =>
      expect(screen.getByTestId('today-sales').textContent).toBe(
        `Сегодня: 1 продажа, всего ${formatMoney(1250000)}`,
      ),
    )
  })

  it('«Ещё» opens /more, the history button /sales', async () => {
    const user = setupUser()
    mockApi({ total: 0, sum_posted: 0 })
    const { router } = renderHome()

    expect((await screen.findByRole('link', { name: 'История продаж' })).getAttribute('href')).toBe(
      '/sales',
    )
    await user.click(screen.getByRole('link', { name: 'Ещё' }))

    expect(router.state.location.pathname).toBe('/more')
    expect(await screen.findByText('Экран «Ещё»')).toBeTruthy()
  })
})

it.each([
  [0, 0],
  [2, 0],
  [0, 5],
  [2, 5],
])('shows only positive stock alerts (%s, %s)', async (out, low) => {
  mockApi(
    { total: 0, sum_posted: 0 },
    0,
    makeStockSummary({ out_of_stock_count: out, low_stock_count: low }),
  )
  renderHome()
  await screen.findByTestId('today-sales')
  await waitFor(() => {
    expect(screen.queryByTestId('home-out') !== null).toBe(out > 0)
    expect(screen.queryByTestId('home-low') !== null).toBe(low > 0)
  })
  if (out) expect(screen.getByTestId('home-out').getAttribute('href')).toBe('/stock?state=out')
  if (low) expect(screen.getByTestId('home-low').getAttribute('href')).toBe('/stock?state=low')
})
