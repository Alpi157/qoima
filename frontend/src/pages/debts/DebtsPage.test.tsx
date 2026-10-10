import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { formatMoney } from '../../lib/money'
import { makeCustomer, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { DebtsPage } from './DebtsPage'

afterEach(() => vi.restoreAllMocks())

describe('DebtsPage', () => {
  it('keeps the API order and shows overpayments below debtors without a minus', async () => {
    const items = [
      makeCustomer({ id: 1, name: 'Большой долг', debt: 900000 }),
      makeCustomer({ id: 2, name: 'Малый долг', debt: 100000 }),
      makeCustomer({ id: 3, name: 'Переплатил', debt: -50000 }),
    ]
    vi.spyOn(api, 'GET').mockReturnValue(
      ok({ items, total: 3, total_debt: 1000000, debtors_count: 2 }),
    )
    renderWithProviders(<DebtsPage />)
    await screen.findByText('Всего долгов')
    const tables = screen.getAllByRole('table')
    expect(
      within(tables[0])
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Большой долг', 'Малый долг'])
    expect(within(tables[1]).getByRole('link').getAttribute('href')).toBe('/customers/3')
    expect(within(tables[1]).getByText(formatMoney(50000).replaceAll('\u00a0', ' '))).toBeTruthy()
    expect(tables[1].textContent).not.toContain('-')
    expect(screen.getByRole('heading', { name: 'Переплатили' })).toBeTruthy()
    expect(screen.queryByText('Сейчас никто не должен.')).toBeNull()
  })

  it.each([{ items: [] }, { items: [makeCustomer({ debt: -50000 })] }])(
    'shows the empty debt state while retaining any overpayments',
    async ({ items }) => {
      vi.spyOn(api, 'GET').mockReturnValue(
        ok({ items, total: items.length, total_debt: 0, debtors_count: 0 }),
      )
      renderWithProviders(<DebtsPage />)
      expect(await screen.findByText('Сейчас никто не должен.')).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Переплатили' }) !== null).toBe(items.length > 0)
    },
  )

  it('uses global totals and does not show empty debt state on an overpayment page', async () => {
    const get = vi.spyOn(api, 'GET').mockReturnValue(
      ok({
        items: [makeCustomer({ debt: -50000 })],
        total: 51,
        total_debt: 900000,
        debtors_count: 50,
      }),
    )
    renderWithProviders(<DebtsPage />, { route: '/debts?page=2' })
    await screen.findByText('Всего долгов')
    expect(get).toHaveBeenCalledWith('/api/customers/debts', {
      params: { query: { limit: 50, offset: 50 } },
    })
    expect(screen.queryByText('Сейчас никто не должен.')).toBeNull()
  })
})
