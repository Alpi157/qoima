import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { makeReturn, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import { ReturnPage } from './ReturnPage'
import { ReturnsPage } from './ReturnsPage'

afterEach(() => vi.restoreAllMocks())

function renderCard() {
  return renderWithDataRouter([{ path: '/returns/:id', element: <ReturnPage /> }], {
    route: '/returns/4',
  })
}

it('shows document, sale link, conditions, amounts and refund method', async () => {
  vi.spyOn(api, 'GET').mockReturnValue(ok(makeReturn()))
  renderCard()
  await screen.findByRole('heading', { name: 'Возврат №10' })
  expect(screen.getByRole('link', { name: 'Накладная №21' }).getAttribute('href')).toBe('/sales/9')
  expect(screen.getAllByText('Годный')).toHaveLength(2)
  for (const badge of screen.getAllByText('Брак'))
    expect(badge.closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning')
  expect(screen.getByText('Списано с долга').parentElement?.textContent).toContain('100')
  expect(screen.getByText('Возвращено деньгами').parentElement?.textContent).toContain('200')
  expect(screen.getByText('Карта / Kaspi')).toBeTruthy()
})

it('cancels with a quick reason and updates the card', async () => {
  const user = setupUser()
  const get = vi.spyOn(api, 'GET').mockReturnValue(ok(makeReturn()))
  const post = vi.spyOn(api, 'POST').mockImplementation(() => {
    const document = makeReturn({
      status: 'cancelled',
      cancel_reason: 'Неверная сумма',
      cancelled_at: '2026-09-29T09:00:00Z',
      cancelled_by_name: 'Владелец',
    })
    get.mockReturnValue(ok(document))
    return ok(document)
  })
  renderCard()
  await user.click(await screen.findByRole('button', { name: 'Отменить возврат' }))
  const modal = within(screen.getByRole('dialog'))
  expect(modal.queryByRole('button', { name: 'Покупатель отказался' })).toBeNull()
  await user.click(modal.getByRole('button', { name: 'Неверная сумма' }))
  await user.click(modal.getByRole('button', { name: 'Отменить возврат' }))
  await screen.findByText('Возврат отменён')
  expect(screen.queryByRole('button', { name: 'Отменить возврат' })).toBeNull()
  expect(post).toHaveBeenCalledWith('/api/returns/{return_id}/cancel', {
    params: { path: { return_id: 4 } },
    body: { reason: 'Неверная сумма' },
  })
})

it('shows shortage items when cancellation is blocked', async () => {
  const user = setupUser()
  vi.spyOn(api, 'GET').mockReturnValue(ok(makeReturn()))
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError(409, '', {}, 'return_cancel_blocked', {
      items: [{ article: 'OC-90', available: 0, requested: 1 }],
    }),
  )
  renderCard()
  await user.click(await screen.findByRole('button', { name: 'Отменить возврат' }))
  const modal = within(screen.getByRole('dialog'))
  await user.click(modal.getByRole('button', { name: 'Ошибка ввода' }))
  await user.click(modal.getByRole('button', { name: 'Отменить возврат' }))
  expect((await modal.findByRole('alert')).textContent).toContain('OC-90')
  expect(modal.getByRole('alert').textContent).toContain('на остатке 0, требуется 1')
})

it('shows not found', async () => {
  vi.spyOn(api, 'GET').mockRejectedValue(new ApiError(404, '', {}, 'return_not_found'))
  renderCard()
  await screen.findByRole('heading', { name: 'Возврат не найден' })
})

it('lists returns and resets pagination when dates change', async () => {
  const get = vi.spyOn(api, 'GET').mockReturnValue(
    ok({
      items: [makeReturn(), makeReturn({ id: 5, number: 11, status: 'cancelled', customer: null })],
      total: 51,
      sum_posted: 30000,
    }),
  )
  const { router } = renderWithDataRouter([{ path: '/returns', element: <ReturnsPage /> }], {
    route: '/returns?page=2',
  })
  const user = setupUser()
  await screen.findByRole('heading', { name: 'История возвратов' })
  await screen.findByRole('table')
  expect(screen.getAllByRole('link', { name: 'Накладная №21' })[0].getAttribute('href')).toBe(
    '/sales/9',
  )
  expect(screen.getAllByText('Отменён')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Сегодня' }))
  await waitFor(() => expect(router.state.location.search).not.toContain('page='))
  expect(get.mock.calls.at(-1)?.[1]).toMatchObject({ params: { query: { offset: 0 } } })
})
