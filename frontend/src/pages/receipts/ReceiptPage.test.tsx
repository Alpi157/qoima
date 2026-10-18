import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { makeReceipt, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser, type TestUser } from '../../test/user'
import { ReceiptPage } from './ReceiptPage'

const POSTED = makeReceipt({
  supplier: 'Начальные остатки',
  lines: [
    {
      product_id: 1,
      article: 'OC-90',
      name: 'Фильтр масляный',
      unit: 'шт',
      qty: 3,
      unit_cost: 150000,
      unit_price_minor: 150000,
      goods_total: 450000,
      expenses_total: 0,
      vat_credit_total: 0,
    },
  ],
  total_qty: 3,
  total_cost: 450000,
})

function renderPage() {
  return renderWithDataRouter([{ path: '/receipts/:id', element: <ReceiptPage /> }], {
    route: '/receipts/5',
  })
}

async function openCancel(user: TestUser) {
  await user.click(await screen.findByRole('button', { name: 'Отменить приход' }))
  return screen.getByRole('dialog', { name: 'Отменить приход №12?' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

const REASON_ERROR = 'Укажите причину, не короче 3 символов'

describe('ReceiptPage', () => {
  it('reference 5 shows saved goods_total instead of qty times rounded unit_cost', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(
      ok(
        makeReceipt({
          currency: 'CNY',
          exchange_rate: '67.8300',
          rate_source: 'nbk',
          rate_date: '2026-10-01',
          lines: [
            {
              ...POSTED.lines[0],
              qty: 3,
              unit_price_minor: 3333,
              goods_total: 678232,
              unit_cost: 226077,
            },
          ],
          goods_total: 678232,
          total_cost: 678232,
        }),
      ),
    )
    renderPage()
    await screen.findByRole('heading', { name: /Приход №12 от/ })
    expect(screen.getByRole('table').textContent).toContain('6\u00a0782,32\u00a0₸')
    expect(screen.getByRole('table').textContent).not.toContain('6\u00a0782,31\u00a0₸')
  })
  it('shows the receipt with its lines and totals', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    renderPage()

    expect(await screen.findByRole('heading', { name: /Приход №12 от/ })).toBeTruthy()
    expect(screen.getByText('Проведён')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'OC-90' })[0].getAttribute('href')).toBe(
      '/products/1',
    )
    expect(screen.getByText('Сумма закупки: 4 500 ₸')).toBeTruthy()
  })

  it('does not cancel without a reason', async () => {
    const user = setupUser()
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    const post = vi.spyOn(api, 'POST')
    renderPage()

    const dialog = await openCancel(user)
    await fill(user, within(dialog).getByRole('textbox', { name: 'Причина' }), ' аб ')
    await user.click(within(dialog).getByRole('button', { name: 'Отменить приход' }))

    expect(post).not.toHaveBeenCalled()
    expect(within(dialog).getByText(REASON_ERROR)).toBeTruthy()
  })

  it('shows a 409 inside the window', async () => {
    const user = setupUser()
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    const message = 'Нельзя отменить приход: остаток OC-90 станет -2'
    const post = vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(409, message))
    renderPage()

    const dialog = await openCancel(user)
    await fill(user, within(dialog).getByRole('textbox', { name: 'Причина' }), 'Ошибка поставщика')
    await user.click(within(dialog).getByRole('button', { name: 'Отменить приход' }))

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(message))
    expect(post).toHaveBeenCalledWith('/api/receipts/{receipt_id}/cancel', {
      params: { path: { receipt_id: 5 } },
      body: { reason: 'Ошибка поставщика' },
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows when and why a cancelled receipt was cancelled', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(
      ok(
        makeReceipt({
          status: 'cancelled',
          cancelled_at: '2026-09-28T04:00:00Z',
          cancel_reason: 'Пересорт',
          cancelled_by_name: 'Анна',
        }),
      ),
    )
    renderPage()

    expect(await screen.findByText('Приход отменён')).toBeTruthy()
    expect(screen.getByText('Когда: 28.09.2026 09:00')).toBeTruthy()
    expect(screen.getByText('Кто: Анна')).toBeTruthy()
    expect(screen.getByText('Причина: Пересорт')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Отменить приход' })).toBeNull()
  })

  it('says "Приход не найден" on 404', async () => {
    vi.spyOn(api, 'GET').mockRejectedValue(new ApiError(404, 'Приход не найден'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Приход не найден' })).toBeTruthy()
  })
})
