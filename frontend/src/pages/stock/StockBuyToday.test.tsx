import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { makeStockBuyToday, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { setupUser } from '../../test/user'
import { StockBuyToday } from './StockBuyToday'

afterEach(() => vi.restoreAllMocks())

it('shows a warning for increased cost and expands currency groups and rates', async () => {
  const user = setupUser()
  vi.spyOn(api, 'GET').mockReturnValue(
    ok(makeStockBuyToday({ without_basis_count: 2, without_basis_cost_value: 10000 })),
  )
  renderWithProviders(<StockBuyToday />)
  expect((await screen.findByText(/Разница:/)).textContent?.replace(/\s/g, ' ')).toContain(
    '+157 500 ₸ (19,6%)',
  )
  expect(screen.getByText(/Товаров без расчёта/).textContent).toContain('2')
  const more = screen.getByRole('button', { name: 'Ещё' })
  expect(more.getAttribute('aria-expanded')).toBe('false')
  await user.click(more)
  expect(more.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/Куплено в валюте Юань:/)).toBeTruthy()
  expect(screen.getByText(/18|20.10.2026/)).toBeTruthy()
})

it('uses a dash when every product is unavailable and omits an undefined percentage', async () => {
  vi.spyOn(api, 'GET').mockReturnValue(
    ok(
      makeStockBuyToday({
        groups: [],
        total: { cost_value: 0, buy_today_value: 0, difference: 0, difference_percent: null },
        without_basis_count: 1,
      }),
    ),
  )
  renderWithProviders(<StockBuyToday />)
  expect((await screen.findByText(/По цене «купить сегодня»:/)).textContent).toContain('—')
  expect(screen.queryByText(/Разница:/)).toBeNull()
})
