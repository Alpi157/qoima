import { notifications } from '@mantine/notifications'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { formatMoney } from '../../lib/money'
import { makeCustomer, makePayment, ok } from '../../test/fixtures'
import { postBody } from '../../test/flowApi'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import type { LedgerItem } from './api'
import { CustomerPage } from './CustomerPage'

const SALE: LedgerItem = {
  kind: 'sale',
  id: 9,
  number: 21,
  occurred_at: '2026-09-27T09:00:00Z',
  amount: 150000,
  paid_at_sale: 50000,
  debt_change: 100000,
  debt_after: 100000,
}
const PAYMENT: LedgerItem = {
  ...SALE,
  kind: 'payment',
  id: 3,
  number: 8,
  amount: 50000,
  paid_at_sale: null,
  debt_change: -50000,
  debt_after: 50000,
}

function mockGet(debt: number, items: LedgerItem[] = []) {
  return vi.spyOn(api, 'GET').mockImplementation(((path: string) => {
    if (path === '/api/customers/{customer_id}') return ok(makeCustomer({ debt }))
    if (path === '/api/customers/{customer_id}/ledger') return ok({ items, total: items.length })
    return ok({ items: [], total: 0, sum_posted: 0 })
  }) as never)
}
function renderCustomer(route = '/customers/7') {
  return renderWithDataRouter([{ path: '/customers/:id', element: <CustomerPage /> }], { route })
}

afterEach(() => vi.restoreAllMocks())

describe('CustomerPage debt and ledger', () => {
  it.each([
    [100000, 'Долг'],
    [0, 'Долга нет'],
    [-100000, 'Переплата'],
  ])('shows debt %i as %s', async (debt, label) => {
    mockGet(debt)
    renderCustomer()
    expect(await screen.findByText(label)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Принять оплату' }) !== null).toBe(debt > 0)
    if (debt)
      expect(screen.getByTestId('customer-debt').textContent).toBe(formatMoney(Math.abs(debt)))
    expect(await screen.findByText('Пока расчётов нет.')).toBeTruthy()
  })

  it('shows signed changes, links sales, and cancels a payment using the selected reason', async () => {
    const user = setupUser()
    const get = mockGet(50000, [PAYMENT, SALE, { ...SALE, id: 10, number: 22, debt_change: 0 }])
    vi.spyOn(notifications, 'show').mockReturnValue('notification')
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makePayment({ status: 'cancelled' })))
    renderCustomer()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Отменить' })).toBeTruthy()
    expect(
      within(table).getByText(`+${formatMoney(100000)}`.replaceAll('\u00a0', ' ')),
    ).toBeTruthy()
    expect(
      within(table).getByText(`\u2212${formatMoney(50000)}`.replaceAll('\u00a0', ' ')),
    ).toBeTruthy()
    expect(within(table).getByText(formatMoney(0).replaceAll('\u00a0', ' '))).toBeTruthy()
    expect(within(table).getByRole('link', { name: 'Продажа №21' }).getAttribute('href')).toBe(
      '/sales/9',
    )
    await user.click(within(table).getByRole('button', { name: 'Отменить' }))
    const modal = await screen.findByRole('dialog')
    expect(within(modal).queryByRole('button', { name: 'Покупатель отказался' })).toBeNull()
    await user.click(within(modal).getByRole('button', { name: 'Неверная сумма' }))
    await user.click(within(modal).getByRole('button', { name: 'Отменить оплату' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(post).toHaveBeenCalledWith('/api/payments/{payment_id}/cancel', {
      params: { path: { payment_id: 3 } },
      body: { reason: 'Неверная сумма' },
    })
    await waitFor(() =>
      expect(
        get.mock.calls.filter((call) => call[0] === '/api/customers/{customer_id}').length,
      ).toBe(2),
    )
    expect(postBody(post)).toEqual({ reason: 'Неверная сумма' })
  })

  it('paginates ledger independently from existing purchases', async () => {
    const user = setupUser()
    const get = mockGet(100000, [SALE])
    get.mockImplementation(((path: string) => {
      if (path === '/api/customers/{customer_id}') return ok(makeCustomer({ debt: 100000 }))
      if (path === '/api/customers/{customer_id}/ledger') return ok({ items: [SALE], total: 51 })
      return ok({ items: [], total: 0, sum_posted: 0 })
    }) as never)
    const { router } = renderCustomer('/customers/7?page=3')
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Следующая страница' }))
    expect(router.state.location.search).toContain('page=3')
    expect(router.state.location.search).toContain('ledgerPage=2')
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/api/customers/{customer_id}/ledger', {
        params: { path: { customer_id: 7 }, query: { limit: 50, offset: 50 } },
      }),
    )
    expect(get.mock.calls.filter((call) => call[0] === '/api/sales')).toHaveLength(1)
  })
})
