import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import type { components } from '../../api/schema'
import { postBody } from '../../test/flowApi'
import { makeProduct, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import { StockAdjustmentModal } from './StockAdjustmentModal'

const PRODUCT = makeProduct({ id: 1, article: 'OC-90', stock: 5 })

function renderModal() {
  const onClose = vi.fn()
  const result = renderWithProviders(
    <StockAdjustmentModal product={PRODUCT} opened onClose={onClose} />,
  )
  return { ...result, onClose }
}

function qtyField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Количество' }) as HTMLInputElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StockAdjustmentModal', () => {
  it('"Списать 3" sends qty = -3 and shows the stock after', async () => {
    const user = setupUser()
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ stock: 2, movement: {} }))
    const { onClose } = renderModal()

    await user.click(screen.getByRole('radio', { name: 'Списать' }))
    await user.clear(qtyField())
    await user.type(qtyField(), '3')
    await user.click(screen.getByRole('button', { name: 'Брак' }))
    expect(screen.getByText(/станет:/).textContent).toBe('Сейчас: 5 шт → станет: 2 шт')
    await user.click(screen.getByRole('button', { name: 'Списать' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith('/api/stock/adjustments', {
      body: { request_id: expect.any(String), product_id: 1, qty: -3, reason: 'Брак' },
      signal: expect.any(AbortSignal),
    })
  })

  it('needs a reason', async () => {
    const user = setupUser()
    const post = vi.spyOn(api, 'POST')
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(post).not.toHaveBeenCalled()
    expect(screen.getByText('Укажите причину, не короче 3 символов')).toBeTruthy()
  })

  it('shows a 409 (stock would go negative) inside the window', async () => {
    const user = setupUser()
    const message = 'Недостаточно товара OC-90: остаток 5, нужно 9'
    vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(409, message))
    const { onClose } = renderModal()

    await user.click(screen.getByRole('radio', { name: 'Списать' }))
    await user.clear(qtyField())
    await user.type(qtyField(), '9')
    await fill(user, screen.getByRole('textbox', { name: 'Причина' }), 'Пересчёт')
    await user.click(screen.getByRole('button', { name: 'Списать' }))

    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(onClose).not.toHaveBeenCalled()
  })
})

it('keeps the adjustment key while open and generates another on reopening', async () => {
  const user = setupUser()
  const post = vi.spyOn(api, 'POST').mockRejectedValue(networkError())
  const first = renderModal()
  await user.click(screen.getByRole('button', { name: 'Брак' }))
  await user.click(screen.getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await screen.findByTestId('unknown-result')
  const original = postBody<components['schemas']['AdjustmentCreate']>(post).request_id
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(postBody<components['schemas']['AdjustmentCreate']>(post, 1).request_id).toBe(original)
  // Unmounting is the same lifetime as the form closing inside StockAdjustmentModal.
  first.unmount()
  renderModal()
  await user.click(screen.getByRole('button', { name: 'Брак' }))
  await user.click(screen.getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
  expect(postBody<components['schemas']['AdjustmentCreate']>(post, 2).request_id).not.toBe(original)
})

it('shows its own adjustment conflict inside the window', async () => {
  const user = setupUser()
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError(409, 'detail', {}, 'stock_adjustment_request_conflict', {
      movement_id: 12,
      product_id: 1,
    }),
  )
  const { onClose } = renderModal()
  await user.click(screen.getByRole('button', { name: 'Брак' }))
  await user.click(screen.getByRole('button', { name: 'Добавить' }))
  expect((await screen.findByRole('alert')).textContent).toContain('историю товара')
  expect(onClose).not.toHaveBeenCalled()
})
