import { Button } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { formatMoney } from '../../lib/money'
import { makeCustomer, makePayment, ok } from '../../test/fixtures'
import { postBody } from '../../test/flowApi'
import { renderWithProviders } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { PaymentCreate } from './api'
import { PaymentModal } from './PaymentModal'

const CUSTOMER = makeCustomer({ debt: 123450 })
function Harness() {
  const [opened, setOpened] = useState(true)
  return (
    <>
      <Button onClick={() => setOpened(true)}>Open</Button>
      <PaymentModal customer={CUSTOMER} opened={opened} onClose={() => setOpened(false)} />
    </>
  )
}

afterEach(() => vi.restoreAllMocks())

describe('PaymentModal', () => {
  it('focuses the amount and fills the whole debt including tiyn', async () => {
    const user = setupUser()
    renderWithProviders(<Harness />)
    const field = await screen.findByRole('textbox', { name: 'Сумма, ₸' })
    await waitFor(() => expect(document.activeElement).toBe(field))
    await user.click(
      screen.getByRole('button', { name: `Весь долг: ${formatMoney(CUSTOMER.debt)}` }),
    )
    expect((field as HTMLInputElement).value).toBe('1234,50')
  })

  it('shows the current backend debt at the amount field and reuses request_id after an error', async () => {
    const user = setupUser()
    vi.spyOn(notifications, 'show').mockReturnValue('notification')
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(
        new ApiError(409, 'Ошибка', {}, 'payment_exceeds_debt', { debt: 100050, amount: 123450 }),
      )
      .mockReturnValue(ok(makePayment()))
    renderWithProviders(<Harness />)
    await user.click(screen.getByRole('button', { name: /Весь долг:/ }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    const error = await screen.findByText(
      `Оплата больше долга. Текущий долг: ${formatMoney(100050)}.`.replaceAll('\u00a0', ' '),
    )
    expect(
      screen.getByRole('textbox', { name: 'Сумма, ₸' }).getAttribute('aria-describedby'),
    ).toContain(error.id)
    await user.click(screen.getByRole('button', { name: `Весь долг: ${formatMoney(100050)}` }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(postBody<PaymentCreate>(post, 0).request_id).toBe(
      postBody<PaymentCreate>(post, 1).request_id,
    )
    expect(postBody<PaymentCreate>(post, 1).amount).toBe(100050)
    expect(postBody<PaymentCreate>(post, 0).paid_at).toBe(postBody<PaymentCreate>(post, 1).paid_at)
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Оплата сохранена' }),
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: /Весь долг:/ }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
    expect(postBody<PaymentCreate>(post, 2).request_id).not.toBe(
      postBody<PaymentCreate>(post, 1).request_id,
    )
  })

  it('rejects zero and malformed amounts without sending a request', async () => {
    const user = setupUser()
    const post = vi.spyOn(api, 'POST')
    renderWithProviders(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Введите сумму больше нуля.')).toBeTruthy()
    await fill(user, screen.getByRole('textbox', { name: 'Сумма, ₸' }), '1,2,3')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Введите сумму, например 12500')).toBeTruthy()
    expect(post).not.toHaveBeenCalled()
  })
})
