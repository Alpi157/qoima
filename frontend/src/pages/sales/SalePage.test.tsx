import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { REASON_ERROR } from '../../lib/validation'
import { makeSale, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { SalePage } from './SalePage'

const POSTED = makeSale({
  customer: { id: 7, name: 'Ержан', phone: '+7 701 123 45 67' },
  lines: [
    {
      product_id: 1,
      article: 'OC-90',
      name: 'Фильтр масляный',
      unit: 'шт',
      qty: 3,
      unit_price: 1250000,
      line_total: 3750000,
    },
  ],
  total: 3750000,
})

function renderPage() {
  return renderWithDataRouter([{ path: '/sales/:id', element: <SalePage /> }], {
    route: '/sales/9',
  })
}

async function openCancel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Отменить продажу' }))
  return screen.getByRole('dialog', { name: 'Отменить продажу №21?' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SalePage', () => {
  it('shows the sale with its customer, lines and total', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    renderPage()

    expect(await screen.findByRole('heading', { name: /Продажа №21 от/ })).toBeTruthy()
    expect(screen.getByText('Проведена')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ержан' }).getAttribute('href')).toBe('/customers/7')
    expect(screen.getAllByRole('link', { name: 'OC-90' })[0].getAttribute('href')).toBe(
      '/products/1',
    )
    expect(screen.getByText('ИТОГО: 37 500 ₸')).toBeTruthy()
  })

  it('does not cancel without a reason', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    const post = vi.spyOn(api, 'POST')
    renderPage()

    const dialog = await openCancel(user)
    await user.click(within(dialog).getByRole('button', { name: 'Отменить продажу' }))

    expect(post).not.toHaveBeenCalled()
    expect(within(dialog).getByText(REASON_ERROR)).toBeTruthy()
  })

  it('cancels with a reason', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(POSTED))
    const post = vi
      .spyOn(api, 'POST')
      .mockReturnValue(ok(makeSale({ ...POSTED, status: 'cancelled' })))
    renderPage()

    const dialog = await openCancel(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Причина' }), 'Возврат')
    await user.click(within(dialog).getByRole('button', { name: 'Отменить продажу' }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/sales/{sale_id}/cancel', {
        params: { path: { sale_id: 9 } },
        body: { reason: 'Возврат' },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows when, who and why for a cancelled sale', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(
      ok(
        makeSale({
          status: 'cancelled',
          cancelled_at: '2026-09-28T04:00:00Z',
          cancelled_by_name: 'Анна',
          cancel_reason: 'Возврат',
        }),
      ),
    )
    renderPage()

    expect(await screen.findByText('Продажа отменена')).toBeTruthy()
    expect(screen.getByText('Когда: 28.09.2026 09:00')).toBeTruthy()
    expect(screen.getByText('Кто: Анна')).toBeTruthy()
    expect(screen.getByText('Причина: Возврат')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Отменить продажу' })).toBeNull()
  })

  it('says "Продажа не найдена" on 404', async () => {
    vi.spyOn(api, 'GET').mockRejectedValue(new ApiError(404, 'Продажа не найдена'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Продажа не найдена' })).toBeTruthy()
  })
})
