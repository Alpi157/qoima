import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { makeProduct, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { StockAdjustmentModal } from './StockAdjustmentModal'

const PRODUCT = makeProduct({ id: 1, article: 'OC-90', stock: 5 })

function renderModal() {
  const onClose = vi.fn()
  renderWithProviders(<StockAdjustmentModal product={PRODUCT} opened onClose={onClose} />)
  return { onClose }
}

function qtyField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Количество' }) as HTMLInputElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StockAdjustmentModal', () => {
  it('"Списать 3" sends qty = -3 and shows the stock after', async () => {
    const user = userEvent.setup()
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
      body: { product_id: 1, qty: -3, reason: 'Брак' },
    })
  })

  it('needs a reason', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(api, 'POST')
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(post).not.toHaveBeenCalled()
    expect(screen.getByText('Укажите причину, не короче 3 символов')).toBeTruthy()
  })

  it('shows a 409 (stock would go negative) inside the window', async () => {
    const user = userEvent.setup()
    const message = 'Недостаточно товара OC-90: остаток 5, нужно 9'
    vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(409, message))
    const { onClose } = renderModal()

    await user.click(screen.getByRole('radio', { name: 'Списать' }))
    await user.clear(qtyField())
    await user.type(qtyField(), '9')
    await user.type(screen.getByRole('textbox', { name: 'Причина' }), 'Пересчёт')
    await user.click(screen.getByRole('button', { name: 'Списать' }))

    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(onClose).not.toHaveBeenCalled()
  })
})
