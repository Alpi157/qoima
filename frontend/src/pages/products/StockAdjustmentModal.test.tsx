import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import { api } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import type { components } from '../../api/schema'
import { postBody } from '../../test/flowApi'
import { makeProduct, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import { StockAdjustmentModal } from './StockAdjustmentModal'
import { useReportSummary } from '../report/api'
import { makeReportSummary } from '../../test/fixtures'

const PRODUCT = makeProduct({ id: 1, article: 'OC-90', stock: 5, avg_cost: 100 })

function renderModal(product = PRODUCT) {
  const onClose = vi.fn()
  const result = renderWithProviders(
    <StockAdjustmentModal product={product} opened onClose={onClose} />,
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
  it.each(['ru', 'kk', 'zh'])(
    'saves the fourth quick reason in both directions (%s)',
    async (language) => {
      await i18n.changeLanguage(language)
      const user = setupUser()
      const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ stock: 4, movement: {} }))
      for (const direction of ['add', 'remove'] as const) {
        const view = renderModal()
        await user.click(
          screen.getByRole('radio', { name: i18n.t(`products.adjust.${direction}`) }),
        )
        const reason = { ru: 'Пересорт', kk: 'Тауар шатасты', zh: '货品混淆' }[language]!
        await user.click(screen.getByRole('button', { name: reason }))
        expect(
          (
            screen.getByRole('textbox', {
              name: i18n.t('products.adjust.reason'),
            }) as HTMLInputElement
          ).value,
        ).toBe(reason)
        await user.click(
          screen.getByRole('button', { name: i18n.t(`products.adjust.${direction}`) }),
        )
        await waitFor(() => expect(post).toHaveBeenCalledTimes(direction === 'add' ? 1 : 2))
        expect(
          postBody<components['schemas']['AdjustmentCreate']>(post, direction === 'add' ? 0 : 1),
        ).toMatchObject({
          reason,
          qty: direction === 'add' ? 1 : -1,
        })
        view.unmount()
      }
    },
  )

  it('refreshes a previously loaded report after saving an adjustment', async () => {
    function CachedReport() {
      const query = useReportSummary('2026-09-01', '2026-09-30', true)
      return <span>{query.data ? 'report ready' : 'loading report'}</span>
    }
    const user = setupUser()
    const get = vi.spyOn(api, 'GET').mockReturnValue(ok(makeReportSummary()))
    vi.spyOn(api, 'POST').mockReturnValue(ok({ stock: 6, movement: {} }))
    renderWithProviders(
      <>
        <CachedReport />
        <StockAdjustmentModal product={PRODUCT} opened onClose={() => {}} />
      </>,
    )
    await screen.findByText('report ready')
    expect(get).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Пересорт' }))
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })
  it.each([0, 12345, null])(
    'requires cost only for unknown positive stock, prefilling %s',
    async (lastCost) => {
      const user = setupUser()
      const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ stock: 6, movement: {} }))
      renderModal(makeProduct({ ...PRODUCT, avg_cost: null, last_cost: lastCost }))
      const price = screen.getByRole('textbox', { name: 'Закупочная цена, ₸' }) as HTMLInputElement
      expect(price.required).toBe(true)
      expect(price.value).toBe(lastCost === null ? '' : lastCost === 0 ? '0' : '123,45')
      await user.click(screen.getByRole('button', { name: 'Пересчёт' }))
      await user.clear(price)
      await user.click(screen.getByRole('button', { name: 'Добавить' }))
      expect(post).not.toHaveBeenCalled()
      expect(screen.getByText('Укажите закупочную цену')).toBeTruthy()
      await fill(user, price, '0')
      await user.click(screen.getByRole('button', { name: 'Добавить' }))
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
      expect(postBody<components['schemas']['AdjustmentCreate']>(post).unit_cost).toBe(0)
    },
  )

  it('hides cost on removal and does not send the hidden price', async () => {
    const user = setupUser()
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ stock: 4, movement: {} }))
    renderModal(makeProduct({ ...PRODUCT, avg_cost: null, last_cost: 15000 }))
    expect(screen.getByRole('textbox', { name: 'Закупочная цена, ₸' })).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Списать' }))
    expect(screen.queryByRole('textbox', { name: 'Закупочная цена, ₸' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Брак' }))
    await user.click(screen.getByRole('button', { name: 'Списать' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(postBody<components['schemas']['AdjustmentCreate']>(post).unit_cost).toBeUndefined()
  })

  it('does not show cost for a known zero average', () => {
    renderModal(makeProduct({ ...PRODUCT, avg_cost: 0 }))
    expect(screen.queryByRole('textbox', { name: 'Закупочная цена, ₸' })).toBeNull()
  })

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
