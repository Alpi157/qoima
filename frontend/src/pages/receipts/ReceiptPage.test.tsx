import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { REASON_ERROR } from '../../lib/validation'
import { makeReceipt, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { ReceiptPage } from './ReceiptPage'

const POSTED = makeReceipt({
  supplier: 'Начальные остатки',
  lines: [{ product_id: 1, article: 'OC-90', name: 'Фильтр масляный', qty: 3, unit_cost: 150000 }],
  total_qty: 3,
  total_cost: 450000,
})

function renderPage() {
  return renderWithDataRouter([{ path: '/receipts/:id', element: <ReceiptPage /> }], {
    route: '/receipts/5',
  })
}

async function openCancel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Отменить приход' }))
  return screen.getByRole('dialog', { name: 'Отменить приход №12?' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReceiptPage', () => {
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
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    const post = vi.spyOn(api, 'POST')
    renderPage()

    const dialog = await openCancel(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Причина' }), ' аб ')
    await user.click(within(dialog).getByRole('button', { name: 'Отменить приход' }))

    expect(post).not.toHaveBeenCalled()
    expect(within(dialog).getByText(REASON_ERROR)).toBeTruthy()
  })

  it('shows a 409 inside the window', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    const message = 'Нельзя отменить приход: остаток OC-90 станет -2'
    const post = vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(409, message))
    renderPage()

    const dialog = await openCancel(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Причина' }), 'Ошибка поставщика')
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
