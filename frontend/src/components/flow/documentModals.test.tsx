import { Button } from '@mantine/core'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import { PaymentModal } from '../../pages/payments/PaymentModal'
import { DebtAdjustmentModal } from '../../pages/debtAdjustments/DebtAdjustmentModal'
import { StockAdjustmentModal } from '../../pages/products/StockAdjustmentModal'
import { makeCustomer, makeProduct } from '../../test/fixtures'
import { postBody } from '../../test/flowApi'
import { renderWithProviders } from '../../test/render'
import { fill, setupUser } from '../../test/user'

type Kind = 'payment' | 'debt' | 'stock'
function Harness({ kind }: { kind: Kind }) {
  const [opened, setOpened] = useState(true)
  const customer = makeCustomer({ debt: 100000 })
  const product = makeProduct({ stock: 5, avg_cost: 100 })
  return (
    <>
      <Button onClick={() => setOpened(true)}>Reopen</Button>
      {kind === 'payment' ? (
        <PaymentModal opened={opened} onClose={() => setOpened(false)} customer={customer} />
      ) : kind === 'debt' ? (
        <DebtAdjustmentModal opened={opened} onClose={() => setOpened(false)} customer={customer} />
      ) : (
        <StockAdjustmentModal opened={opened} onClose={() => setOpened(false)} product={product} />
      )}
    </>
  )
}
async function enter(kind: Kind) {
  const user = setupUser()
  if (kind === 'stock') await user.click(screen.getByRole('button', { name: 'Брак' }))
  else {
    await fill(user, screen.getByRole('textbox', { name: 'Сумма, ₸' }), '100')
    if (kind === 'debt') {
      await user.click(screen.getByRole('button', { name: 'Увеличить долг' }))
      await user.click(screen.getByRole('button', { name: 'Начальный остаток' }))
    }
  }
  await user.click(
    screen.getByRole('button', { name: kind === 'stock' ? 'Добавить' : 'Сохранить' }),
  )
  return user
}
afterEach(() => vi.restoreAllMocks())

it.each(['payment', 'debt', 'stock'] as const)(
  '%s keeps its key, guards close, preserves input and invalidates on confirmed close',
  async (kind) => {
    const post = vi.spyOn(api, 'POST').mockRejectedValue(networkError())
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderWithProviders(<Harness kind={kind} />)
    const user = await enter(kind)
    await screen.findByTestId('unknown-result')
    const first = postBody<{ request_id: string }>(post).request_id
    await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(postBody<{ request_id: string }>(post, 1).request_id).toBe(first)
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    const confirmation = await screen.findByRole('alert')
    expect(confirmation.textContent).toContain('возможно, сохранена')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(within(confirmation).getByRole('button', { name: 'Продолжить ввод' }))
    expect(await screen.findByTestId('unknown-result')).toBeTruthy()
    await user.keyboard('{Escape}')
    const again = await screen.findByRole('alert')
    await user.click(within(again).getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(invalidate).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    await enter(kind)
    expect(postBody<{ request_id: string }>(post, 2).request_id).not.toBe(first)
  },
)

it.each(['payment', 'debt', 'stock'] as const)(
  '%s conflict offers opening and explicit clearing with a new key',
  async (kind) => {
    const code =
      kind === 'payment'
        ? 'payment_request_conflict'
        : kind === 'debt'
          ? 'debt_adjustment_request_conflict'
          : 'stock_adjustment_request_conflict'
    const post = vi.spyOn(api, 'POST').mockRejectedValue(
      new ApiError(409, 'Conflict', {}, code, {
        id: 8,
        number: 42,
        product_id: 1,
        movement_id: 9,
      }),
    )
    renderWithProviders(<Harness kind={kind} />)
    const user = await enter(kind)
    const block = await screen.findByTestId('request-conflict')
    if (kind !== 'stock') expect(block.textContent).toContain('№42')
    expect(within(block).getByRole('button', { name: 'Открыть' })).toBeTruthy()
    const first = postBody<{ request_id: string }>(post).request_id
    await user.click(within(block).getByRole('button', { name: 'Очистить' }))
    expect(screen.queryByTestId('request-conflict')).toBeNull()
    await enter(kind)
    expect(postBody<{ request_id: string }>(post, 1).request_id).not.toBe(first)
  },
)

it.each(['cross', 'overlay'] as const)(
  'guards %s closing after an unknown payment',
  async (way) => {
    vi.spyOn(api, 'POST').mockRejectedValue(networkError())
    renderWithProviders(<Harness kind="payment" />)
    const user = await enter('payment')
    await screen.findByTestId('unknown-result')
    if (way === 'cross') await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    else await user.click(document.querySelector('.mantine-Modal-overlay') as HTMLElement)
    expect((await screen.findByRole('alert')).textContent).toContain('возможно, сохранена')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  },
)
