import { Button } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { tiynToInput } from '../../lib/money'
import { makeCustomer, makeDebtAdjustment, ok } from '../../test/fixtures'
import { postBody } from '../../test/flowApi'
import { renderWithProviders } from '../../test/render'
import { fill as paste, setupUser, type TestUser } from '../../test/user'
import type { DebtAdjustmentCreate } from './api'
import { DebtAdjustmentModal } from './DebtAdjustmentModal'

function Harness({ debt = 100000 }: { debt?: number }) {
  const [opened, setOpened] = useState(true)
  return (
    <>
      <Button onClick={() => setOpened(true)}>Open</Button>
      <DebtAdjustmentModal
        customer={makeCustomer({ debt })}
        opened={opened}
        onClose={() => setOpened(false)}
      />
    </>
  )
}

afterEach(() => vi.restoreAllMocks())

async function fill(user: TestUser, field: HTMLElement, value: string) {
  await user.clear(field)
  await paste(user, field, value)
}

async function complete(
  direction = 'Увеличить долг',
  amount = '100',
  reason = 'Начальный остаток',
) {
  const user = setupUser()
  await user.click(screen.getByRole('button', { name: direction }))
  await fill(user, screen.getByRole('textbox', { name: 'Сумма, ₸' }), amount)
  await user.click(screen.getByRole('button', { name: reason }))
  return user
}

describe('DebtAdjustmentModal', () => {
  it.each([
    [null, ['Исправление ошибки']],
    ['Увеличить долг', ['Начальный остаток', 'Исправление ошибки']],
    ['Уменьшить долг', ['Долг прощён', 'Исправление ошибки']],
  ] as const)('offers reasons appropriate to direction %s', async (direction, expected) => {
    renderWithProviders(<Harness />)
    if (direction) await setupUser().click(screen.getByRole('button', { name: direction }))
    for (const reason of ['Начальный остаток', 'Долг прощён', 'Исправление ошибки']) {
      expect(Boolean(screen.queryByRole('button', { name: reason }))).toBe(
        expected.some((value) => value === reason),
      )
    }
  })

  it.each([
    ['Увеличить долг', 'Начальный остаток', 'Уменьшить долг'],
    ['Уменьшить долг', 'Долг прощён', 'Увеличить долг'],
  ])('clears the incompatible quick reason (%s)', async (from, reason, to) => {
    renderWithProviders(<Harness />)
    const user = await complete(from, '100', reason)
    await user.click(screen.getByRole('button', { name: to }))
    expect((screen.getByRole('textbox', { name: 'Причина' }) as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it.each(['Своя причина', 'Начальный остаток'])(
    'preserves manually entered text (%s)',
    async (text) => {
      renderWithProviders(<Harness />)
      const user = await complete()
      await fill(user, screen.getByRole('textbox', { name: 'Причина' }), text)
      await user.click(screen.getByRole('button', { name: 'Уменьшить долг' }))
      expect((screen.getByRole('textbox', { name: 'Причина' }) as HTMLTextAreaElement).value).toBe(
        text,
      )
    },
  )

  it('preserves the mistake reason across direction changes', async () => {
    renderWithProviders(<Harness />)
    const user = await complete('Увеличить долг', '100', 'Исправление ошибки')
    await user.click(screen.getByRole('button', { name: 'Уменьшить долг' }))
    expect((screen.getByRole('textbox', { name: 'Причина' }) as HTMLTextAreaElement).value).toBe(
      'Исправление ошибки',
    )
  })

  it('requires an explicit direction, positive amount and reason, including direct form submission', async () => {
    const user = setupUser()
    const post = vi.spyOn(api, 'POST')
    renderWithProviders(<Harness />)
    const save = screen.getByRole('button', { name: 'Сохранить' })
    const field = screen.getByRole('textbox', { name: 'Сумма, ₸' })
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(screen.queryByText(/Долг после исправления:/)).toBeNull()
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Увеличить долг' }).getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      screen.getByRole('button', { name: 'Уменьшить долг' }).getAttribute('aria-pressed'),
    ).toBe('false')
    await fill(user, field, '100')
    await user.click(screen.getByRole('button', { name: 'Исправление ошибки' }))
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(save.closest('form')!)
    expect(post).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Увеличить долг' }))
    expect((save as HTMLButtonElement).disabled).toBe(false)
    await fill(user, field, '0')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await fill(user, field, '1,2,3')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Введите сумму, например 12500')).toBeTruthy()
    await fill(user, field, '100')
    await fill(user, screen.getByRole('textbox', { name: 'Причина' }), '  ')
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['Увеличить долг', 'Начальный остаток', 100050, '2 000,50'],
    ['Уменьшить долг', 'Долг прощён', -50050, '499,50'],
    ['Увеличить долг', 'Исправление ошибки', 100050, '2 000,50'],
  ])(
    'sends signed tiyn and the quick reason (%s, %s)',
    async (direction, reason, amount, after) => {
      const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeDebtAdjustment()))
      vi.spyOn(notifications, 'show').mockReturnValue('notification')
      renderWithProviders(<Harness />)
      const user = await complete(direction, tiynToInput(Math.abs(Number(amount))), reason)
      expect(screen.getByText(`Долг после исправления: ${after} ₸`)).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Сохранить' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(postBody<DebtAdjustmentCreate>(post)).toEqual(
        expect.objectContaining({ amount, reason, customer_id: 7 }),
      )
      expect(postBody<DebtAdjustmentCreate>(post).request_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Исправление долга сохранено' }),
      )
    },
  )

  it('allows a custom reason to replace the quick choice and trims it', async () => {
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeDebtAdjustment()))
    renderWithProviders(<Harness />)
    const user = await complete()
    await fill(user, screen.getByRole('textbox', { name: 'Причина' }), '  Своя причина  ')
    expect(
      screen.getByRole('button', { name: 'Начальный остаток' }).getAttribute('aria-pressed'),
    ).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(postBody<DebtAdjustmentCreate>(post).reason).toBe('Своя причина')
  })

  it('updates the debt and preview from the server error and reuses request_id and time on retry', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(
        new ApiError(409, 'Ошибка', {}, 'debt_adjustment_exceeds_debt', {
          debt: 50000,
          amount: -70000,
        }),
      )
      .mockReturnValue(ok(makeDebtAdjustment()))
    renderWithProviders(<Harness />)
    const user = await complete('Уменьшить долг', '700', 'Долг прощён')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    const error = await screen.findByText('Нельзя уменьшить больше долга. Текущий долг: 500 ₸.')
    expect(
      screen.getByRole('textbox', { name: 'Сумма, ₸' }).getAttribute('aria-describedby'),
    ).toContain(error.id)
    expect(screen.getByText('Текущий долг: 500 ₸')).toBeTruthy()
    expect(screen.getByText('Долг после исправления: -200 ₸')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Причина' }) as HTMLTextAreaElement).value).toBe(
      'Долг прощён',
    )
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await fill(user, screen.getByRole('textbox', { name: 'Сумма, ₸' }), '500')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const first = postBody<DebtAdjustmentCreate>(post, 0)
    const second = postBody<DebtAdjustmentCreate>(post, 1)
    expect(first.request_id).toBe(second.request_id)
    expect(first.adjusted_at).toBe(second.adjusted_at)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.queryByText(/Долг после исправления:/)).toBeNull()
    await complete()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
    expect(postBody<DebtAdjustmentCreate>(post, 2).request_id).not.toBe(first.request_id)
  })

  it('blocks a reduction above the known debt at the amount field', async () => {
    const post = vi.spyOn(api, 'POST')
    renderWithProviders(<Harness />)
    await complete('Уменьшить долг', '1000,01', 'Долг прощён')
    expect(screen.getByText('Нельзя уменьшить больше долга. Текущий долг: 1 000 ₸.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    [100000, '999,99', false],
    [100000, '1000', true],
    [0, '1000', false],
    [-100000, '1000', false],
  ])(
    'warns at the double-debt threshold only for positive debt (%i, %s)',
    async (debt, amount, warning) => {
      renderWithProviders(<Harness debt={Number(debt)} />)
      const user = await complete('Увеличить долг', String(amount))
      expect(screen.queryByText('Проверьте сумму. Нет ли лишнего нуля?') !== null).toBe(warning)
      const preview = screen.getByText(/Долг после исправления:/)
      if (warning) expect(preview.style.color).toBe('var(--q-color-warning-text)')
      expect(
        (screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled,
      ).toBe(false)
      await user.click(screen.getByRole('button', { name: 'Уменьшить долг' }))
      expect(screen.queryByText('Проверьте сумму. Нет ли лишнего нуля?')).toBeNull()
    },
  )

  it('opens the date section when the backend rejects the date', async () => {
    const post = vi.spyOn(api, 'POST').mockRejectedValueOnce(
      new ApiError(
        422,
        'Ошибка',
        {
          adjusted_at: { message: 'Дата', type: 'date_in_future', params: {} },
        },
        'validation_error',
      ),
    )
    renderWithProviders(<Harness />)
    const user = await complete()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText('Дата не может быть в будущем')
    expect(
      screen.getByRole('button', { name: 'Дополнительно' }).getAttribute('aria-expanded'),
    ).toBe('true')
    expect(post).toHaveBeenCalledTimes(1)
  })
})
