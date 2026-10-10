import { notifications } from '@mantine/notifications'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { formatMoney } from '../../lib/money'
import { makeCustomer, makePayment, makeDebtAdjustment, ok } from '../../test/fixtures'
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
  payment_method: 'cash',
  refund_amount: null,
  refund_method: null,
  reason: null,
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
  it('links returns, shows signed debt credit and money refunded with method', async () => {
    mockGet(50000, [
      {
        ...SALE,
        kind: 'return',
        id: 4,
        number: 10,
        amount: 100000,
        paid_at_sale: null,
        payment_method: null,
        debt_change: -50000,
        refund_amount: 50000,
        refund_method: 'card',
      },
      {
        ...SALE,
        kind: 'return',
        id: 5,
        number: 11,
        debt_change: 0,
        paid_at_sale: null,
        payment_method: null,
        refund_amount: 0,
        refund_method: null,
      },
    ])
    renderCustomer()
    const table = within(await screen.findByRole('table'))
    expect(table.getByRole('link', { name: 'Возврат №10' }).getAttribute('href')).toBe('/returns/4')
    expect(table.getByText('−500 ₸')).toBeTruthy()
    expect(table.getByText('0 ₸')).toBeTruthy()
    expect(table.getByText('Возвращено деньгами: 500 ₸')).toBeTruthy()
    expect(table.getByText('Карта / Kaspi')).toBeTruthy()
    expect(table.queryByRole('button', { name: 'Отменить' })).toBeNull()
  })

  it.each([
    ['unpaid', 'Не оплачено: 500 ₸'],
    ['partial', 'Частично, осталось 500 ₸'],
    ['returned', 'Возвращено'],
    ['paid', null],
  ] as const)('shows invoice payment status in purchases (%s)', async (status, label) => {
    const get = mockGet(50000)
    get.mockImplementation(((path: string) =>
      path === '/api/customers/{customer_id}'
        ? ok(makeCustomer({ debt: 50000 }))
        : path.endsWith('/ledger')
          ? ok({ items: [], total: 0 })
          : ok({
              items: [
                {
                  id: 9,
                  number: 21,
                  sold_at: SALE.occurred_at,
                  status: 'posted',
                  payment_status: status,
                  outstanding: 50000,
                  total: 150000,
                },
              ],
              total: 1,
              sum_posted: 150000,
            })) as never)
    renderCustomer()
    await screen.findByRole('table')
    if (label) expect(screen.getAllByText(label)).toHaveLength(2)
    else expect(screen.queryByText('Оплачено', { exact: true })).toBeNull()
  })
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
      if (path === '/api/customers/{customer_id}/ledger')
        return ok({
          items: [{ ...SALE, kind: 'adjustment', reason: 'Начальный остаток' }],
          total: 51,
        })
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

it('labels the actual partial payment in a sale and the amount of a card debt payment', async () => {
  mockGet(50000, [
    SALE,
    { ...PAYMENT, payment_method: 'card' },
    { ...SALE, id: 10, number: 22, paid_at_sale: 0, payment_method: null },
  ])
  renderCustomer()
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row')
  expect(rows[1].textContent).toContain(`Оплачено: ${formatMoney(50000)}`)
  expect(rows[1].textContent).toContain('Наличные')
  expect(rows[2].textContent).toContain('Карта / Kaspi')
  expect(rows[3].textContent).not.toContain('Наличные')
})

it.each([100000, -100000])(
  'shows adjustment %i, reason and signed change on desktop and mobile',
  async (amount) => {
    mockGet(50000, [
      {
        ...SALE,
        kind: 'adjustment',
        id: 4,
        number: 10,
        amount,
        paid_at_sale: null,
        payment_method: null,
        reason: 'Начальный остаток',
        debt_change: amount,
      },
    ])
    renderCustomer()
    const table = within(await screen.findByRole('table'))
    expect(table.getByText('Исправление №10')).toBeTruthy()
    expect(table.getByText('Начальный остаток')).toBeTruthy()
    expect(table.getByText(`${amount > 0 ? '+' : '−'}1 000 ₸`)).toBeTruthy()
    expect(screen.getAllByText('Начальный остаток')).toHaveLength(2)
    expect(table.getByRole('button', { name: 'Отменить' })).toBeTruthy()
  },
)

it('opens adjustments at zero debt and cancels an adjustment with the single quick reason', async () => {
  const user = setupUser()
  let cancelled = false
  const item: LedgerItem = {
    ...SALE,
    kind: 'adjustment',
    id: 4,
    number: 10,
    amount: 100000,
    paid_at_sale: null,
    payment_method: null,
    reason: 'Начальный остаток',
    debt_change: 100000,
  }
  const get = vi.spyOn(api, 'GET').mockImplementation(((path: string) => {
    if (path === '/api/customers/{customer_id}')
      return ok(makeCustomer({ debt: cancelled ? -100000 : 0 }))
    if (path.endsWith('/ledger'))
      return ok({ items: cancelled ? [] : [item], total: cancelled ? 0 : 1 })
    return ok({ items: [], total: 0, sum_posted: 0 })
  }) as never)
  const post = vi.spyOn(api, 'POST').mockImplementation(() => {
    cancelled = true
    return ok(makeDebtAdjustment({ status: 'cancelled' }))
  })
  renderCustomer()
  await user.click(await screen.findByRole('button', { name: 'Исправить долг' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Отмена' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const table = within(await screen.findByRole('table'))
  await user.click(table.getByRole('button', { name: 'Отменить' }))
  const dialog = within(await screen.findByRole('dialog'))
  expect(dialog.queryByRole('button', { name: 'Неверная сумма' })).toBeNull()
  await user.click(dialog.getByRole('button', { name: 'Ошибка ввода' }))
  await user.click(dialog.getByRole('button', { name: 'Отменить исправление' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(post).toHaveBeenCalledWith('/api/debt-adjustments/{debt_adjustment_id}/cancel', {
    params: { path: { debt_adjustment_id: 4 } },
    body: { reason: 'Ошибка ввода' },
  })
  expect(await screen.findByText('Переплата')).toBeTruthy()
  expect(await screen.findByText('Пока расчётов нет.')).toBeTruthy()
  expect(
    get.mock.calls.filter((call) => String(call[0]).endsWith('/ledger')).length,
  ).toBeGreaterThan(1)
})
