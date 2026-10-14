import { screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { makeCustomer, makePayment, makeDebtAdjustment, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { LedgerItem } from './api'
import { CustomerLedger } from './CustomerLedger'
import { CustomerPage } from './CustomerPage'

function item(id: number, kind: 'payment' | 'adjustment' = 'payment'): LedgerItem {
  return {
    kind,
    id,
    number: id,
    occurred_at: '2026-09-27T09:00:00Z',
    amount: 1000,
    paid_at_sale: null,
    payment_method: 'cash',
    refund_amount: null,
    refund_method: null,
    reason: null,
    debt_change: -1000,
    debt_after: 10000,
  }
}
afterEach(() => vi.restoreAllMocks())

it('locates a document on the second ledger page and highlights its table row and mobile card', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => item(i + 1))
  const get = vi.spyOn(api, 'GET').mockImplementation(((
    path: string,
    init?: { params?: { query?: { offset?: number } } },
  ) =>
    path === '/api/payments/{payment_id}'
      ? ok(makePayment({ id: 51 }))
      : ok({
          items: rows.slice(
            init?.params?.query?.offset ?? 0,
            (init?.params?.query?.offset ?? 0) + 50,
          ),
          total: 51,
        })) as never)
  const { router } = renderWithDataRouter(
    [{ path: '/customers/:id', element: <CustomerLedger customerId={7} /> }],
    { route: '/customers/7?ledgerFocus=payment:51&page=3' },
  )
  await waitFor(() => expect(router.state.location.search).toContain('ledgerPage=2'))
  await waitFor(() =>
    expect(
      document.querySelectorAll('[data-row-key="payment-51"][data-highlighted="true"]').length,
    ).toBe(2),
  )
  expect(router.state.location.search).toContain('page=3')
  expect(router.state.location.search).not.toContain('ledgerFocus')
  expect(
    (get.mock.calls as unknown as [string, { params?: { query?: { offset?: number } } }][]).some(
      ([, init]) =>
        (init as { params?: { query?: { offset?: number } } })?.params?.query?.offset === 50,
    ),
  ).toBe(true)
})

it.each(['payment', 'adjustment'] as const)(
  'shows a simple cancelled %s card outside the ledger',
  async (kind) => {
    vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
      path.endsWith('/ledger')
        ? ok({ items: [], total: 0 })
        : ok(
            kind === 'payment'
              ? makePayment({ status: 'cancelled', cancel_reason: 'Ошибка' })
              : makeDebtAdjustment({ status: 'cancelled', cancel_reason: 'Ошибка' }),
          )) as never)
    const { router } = renderWithDataRouter(
      [{ path: '/customers/:id', element: <CustomerLedger customerId={7} /> }],
      { route: `/customers/7?ledgerFocus=${kind}:3` },
    )
    await screen.findByText(/№.*отменена/)
    expect(screen.getByText('Причина: Ошибка')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    await setupUser().click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(router.state.location.search).not.toContain('ledgerFocus'))
    expect(screen.queryByText(/№.*отменена/)).toBeNull()
  },
)

it('opening a conflicting payment closes its modal and highlights the stored payment on the same customer page', async () => {
  const payment = makePayment()
  vi.spyOn(api, 'GET').mockImplementation(((path: string) => {
    if (path === '/api/customers/{customer_id}') return ok(makeCustomer({ debt: 100000 }))
    if (path === '/api/payments/{payment_id}') return ok(payment)
    if (path.endsWith('/ledger')) return ok({ items: [item(payment.id)], total: 1 })
    return ok({ items: [], total: 0, sum_posted: 0 })
  }) as never)
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError(409, 'Conflict', {}, 'payment_request_conflict', {
      id: payment.id,
      number: payment.number,
    }),
  )
  const { router } = renderWithDataRouter([{ path: '/customers/:id', element: <CustomerPage /> }], {
    route: '/customers/7',
  })
  const user = setupUser()
  await user.click(await screen.findByRole('button', { name: 'Принять оплату' }))
  await fill(user, screen.getByRole('textbox', { name: 'Сумма, ₸' }), '100')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByTestId('request-conflict')
  await user.click(screen.getByRole('button', { name: 'Открыть' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(router.state.location.pathname).toBe('/customers/7')
  await waitFor(() =>
    expect(
      document.querySelector(`[data-row-key="payment-${payment.id}"][data-highlighted="true"]`),
    ).not.toBeNull(),
  )
})
