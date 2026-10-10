import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { makeCustomer, makeReturn, makeSale, ok, fieldError } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import { postBody } from '../../test/flowApi'
import type { Sale } from '../sales/api'
import type { ReturnCreate } from './api'
import { ReturnCreatePage } from './ReturnCreatePage'

const sale = makeSale({
  customer: { id: 7, name: 'Ержан', phone: null },
  status: 'posted',
  lines: [
    {
      id: 11,
      product_id: 1,
      article: 'OC-90',
      name: 'Фильтр',
      unit: 'шт',
      qty: 3,
      returned_qty: 1,
      unit_price: 10000,
      line_total: 30000,
      unit_cost: 5000,
    },
    {
      id: 12,
      product_id: 2,
      article: 'OC-91',
      name: 'Свеча',
      unit: 'шт',
      qty: 3,
      returned_qty: 0,
      unit_price: 20000,
      line_total: 60000,
      unit_cost: 10000,
    },
    {
      id: 13,
      product_id: 3,
      article: 'OC-92',
      name: 'Полный',
      unit: 'шт',
      qty: 2,
      returned_qty: 2,
      unit_price: 30000,
      line_total: 60000,
      unit_cost: null,
    },
  ],
})

function renderForm(debt = 100000, document: Sale = sale) {
  const get = vi
    .spyOn(api, 'GET')
    .mockImplementation(((path: string) =>
      path === '/api/sales/{sale_id}' ? ok(document) : ok(makeCustomer({ debt }))) as never)
  const view = renderWithDataRouter(
    [
      { path: '/sales/:id/return', element: <ReturnCreatePage /> },
      { path: '/returns/:id', element: <p>Сохранённый возврат</p> },
    ],
    { route: '/sales/9/return' },
  )
  return { ...view, get }
}

async function choose(qty = '1') {
  const user = setupUser()
  const field = await screen.findByRole('textbox', { name: 'Количество OC-90' })
  await user.clear(field)
  await user.type(field, qty)
  return user
}

afterEach(() => vi.restoreAllMocks())

describe('ReturnCreatePage', () => {
  it('starts at zero, bounds the stepper and shows fully returned lines without a field', async () => {
    renderForm()
    const input = await screen.findByRole('textbox', { name: 'Количество OC-90' })
    expect(screen.getByText('Ержан').tagName).toBe('B')
    expect(screen.queryByText(/<b>/)).toBeNull()
    expect((input as HTMLInputElement).value).toBe('0')
    const card = within(screen.getByText('OC-90').closest('.mantine-Card-root') as HTMLElement)
    expect(card.getByRole('button', { name: 'Уменьшить' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'Количество OC-92' })).toBeNull()
    expect(screen.getByText('Возвращено полностью')).toBeTruthy()
    expect(screen.queryByText('Годный, вернётся на склад')).toBeNull()
    const user = setupUser()
    await user.click(card.getByRole('button', { name: 'Увеличить' }))
    expect(card.getByText('Годный, вернётся на склад')).toBeTruthy()
    await user.click(card.getByRole('button', { name: 'Увеличить' }))
    expect(card.getByRole('button', { name: 'Увеличить' }).hasAttribute('disabled')).toBe(true)
    await user.click(card.getByRole('button', { name: 'Уменьшить' }))
    await user.click(card.getByRole('button', { name: 'Уменьшить' }))
    expect(card.queryByText('Годный, вернётся на склад')).toBeNull()
    expect(screen.getByRole('button', { name: 'Сохранить возврат' }).hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('returns all available units', async () => {
    renderForm()
    const user = setupUser()
    await user.click(await screen.findByRole('button', { name: 'Вернуть всё' }))
    expect(
      (screen.getByRole('textbox', { name: 'Количество OC-90' }) as HTMLInputElement).value,
    ).toBe('2')
    expect(
      (screen.getByRole('textbox', { name: 'Количество OC-91' }) as HTMLInputElement).value,
    ).toBe('3')
    expect(screen.getByTestId('return-credit').textContent?.replaceAll('\u00a0', ' ')).toBe(
      'Уйдёт в счёт долга: 800 ₸',
    )
  })

  it.each([
    [100000, '100 ₸', '0 ₸', false],
    [5000, '50 ₸', '50 ₸', true],
    [10000, '100 ₸', '0 ₸', false],
    [0, '0 ₸', '100 ₸', true],
    [-10000, '0 ₸', '100 ₸', true],
  ])('previews debt %s', async (debt, credit, refund, method) => {
    renderForm(debt)
    await choose()
    expect(screen.getByTestId('return-credit').textContent?.replaceAll('\u00a0', ' ')).toBe(
      `Уйдёт в счёт долга: ${credit}`,
    )
    expect(screen.getByTestId('return-refund').textContent?.replaceAll('\u00a0', ' ')).toBe(
      `Вернуть деньгами: ${refund}`,
    )
    expect(Boolean(screen.queryByText('Как вернули деньги?'))).toBe(method)
  })

  it('refunds everything without a customer and sends only selected line ids, condition and expected amounts', async () => {
    renderForm(0, { ...sale, customer: null })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReturn()))
    const user = await choose()
    expect(screen.queryByTestId('return-credit')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Брак, на склад не вернётся' }))
    await user.click(screen.getByRole('button', { name: 'Карта / Kaspi' }))
    await user.click(screen.getByRole('button', { name: 'Дополнительно' }))
    await user.click(screen.getByRole('button', { name: 'Не подошло' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await screen.findByText('Сохранённый возврат')
    expect(postBody<ReturnCreate>(post)).toMatchObject({
      sale_id: 9,
      expected_debt_credit: 0,
      expected_refund_amount: 10000,
      refund_method: 'card',
      note: 'Не подошло',
      lines: [{ sale_line_id: 11, qty: 1, condition: 'defective' }],
    })
    expect(postBody<ReturnCreate>(post).request_id).toMatch(/^[a-f0-9-]{36}$/)
  })

  it('omits refund_method when no money is refunded', async () => {
    renderForm()
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReturn()))
    const user = await choose()
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(postBody<ReturnCreate>(post)).not.toHaveProperty('refund_method')
    expect(postBody<ReturnCreate>(post)).toMatchObject({
      expected_debt_credit: 10000,
      expected_refund_amount: 0,
    })
  })

  it('shows a quantity conflict at its line', async () => {
    renderForm()
    vi.spyOn(api, 'POST').mockRejectedValue(
      new ApiError(409, '', {}, 'return_qty_exceeds_sold', {
        article: 'OC-90',
        sold: 3,
        returned: 3,
        requested: 1,
      }),
    )
    const user = await choose()
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    const card = within(screen.getByText('OC-90').closest('.mantine-Card-root') as HTMLElement)
    expect(
      await card.findByText('OC-90: продано 3, уже возвращено 3. Вернуть 1 нельзя.'),
    ).toBeTruthy()
  })

  it.each([
    [100000, 5000, 5000, true],
    [0, 10000, 0, false],
  ])(
    'stops on changed split and retries with the same request id',
    async (debt, credit, refund, showMethod) => {
      const { get } = renderForm(debt)
      const post = vi
        .spyOn(api, 'POST')
        .mockRejectedValueOnce(
          new ApiError(409, '', {}, 'return_split_changed', {
            debt_credit: credit,
            refund_amount: refund,
          }),
        )
        .mockReturnValueOnce(ok(makeReturn()))
      const user = await choose()
      await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
      await screen.findByText('Долг изменился, проверьте расчёт.')
      await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
      expect(post).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('return-credit').getAttribute('data-changed')).toBe('true')
      expect(screen.getByTestId('return-refund').getAttribute('data-changed')).toBe('true')
      expect(Boolean(screen.queryByText('Как вернули деньги?'))).toBe(showMethod)
      await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
      await screen.findByText('Сохранённый возврат')
      expect(postBody<ReturnCreate>(post, 1).request_id).toBe(
        postBody<ReturnCreate>(post).request_id,
      )
      expect(postBody<ReturnCreate>(post, 1)).toMatchObject({
        expected_debt_credit: credit,
        expected_refund_amount: refund,
      })
    },
  )

  it('reloads debt after refund_method_without_refund and preserves request id', async () => {
    const { get } = renderForm(0)
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(
        new ApiError(
          422,
          '',
          { refund_method: fieldError('', 'refund_method_without_refund') },
          'validation_error',
        ),
      )
      .mockReturnValueOnce(ok(makeReturn()))
    const user = await choose()
    get.mockImplementation(((path: string) =>
      path === '/api/sales/{sale_id}' ? ok(sale) : ok(makeCustomer({ debt: 100000 }))) as never)
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await screen.findByText('Долг изменился, проверьте расчёт.')
    await waitFor(() => expect(screen.queryByText('Как вернули деньги?')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await screen.findByText('Сохранённый возврат')
    expect(postBody<ReturnCreate>(post, 1).request_id).toBe(postBody<ReturnCreate>(post).request_id)
    expect(postBody<ReturnCreate>(post, 1)).not.toHaveProperty('refund_method')
  })

  it('does not preflight debt or stop when backend accepts unchanged split', async () => {
    const { get } = renderForm()
    const post = vi.spyOn(api, 'POST').mockImplementation(() => {
      expect(get).toHaveBeenCalledTimes(2)
      return ok(makeReturn())
    })
    const user = await choose()
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await screen.findByText('Сохранённый возврат')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('keeps the form and request id when reloading debt fails', async () => {
    const { get } = renderForm(0)
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(
        new ApiError(409, '', {}, 'return_split_changed', {
          debt_credit: 10000,
          refund_amount: 0,
        }),
      )
      .mockReturnValueOnce(ok(makeReturn()))
    const user = await choose()
    get.mockRejectedValueOnce(new ApiError(503, '', {}, 'http_error'))
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await screen.findByRole('button', { name: 'Повторить' })
    expect(
      (screen.getByRole('textbox', { name: 'Количество OC-90' }) as HTMLInputElement).value,
    ).toBe('1')
    expect(screen.getByRole('button', { name: 'Сохранить возврат' }).hasAttribute('disabled')).toBe(
      true,
    )
    get.mockImplementation(((path: string) =>
      path === '/api/sales/{sale_id}' ? ok(sale) : ok(makeCustomer({ debt: 100000 }))) as never)
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Сохранить возврат' }).hasAttribute('disabled'),
      ).toBe(false),
    )
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await screen.findByText('Сохранённый возврат')
    expect(postBody<ReturnCreate>(post, 1).request_id).toBe(postBody<ReturnCreate>(post).request_id)
  })

  it('retries the identical request after an uncertain network result', async () => {
    renderForm()
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(ok(makeReturn()))
    const user = await choose()
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Количество OC-90' }).hasAttribute('disabled') ||
          (screen.getByRole('textbox', { name: 'Количество OC-90' }) as HTMLInputElement).matches(
            ':disabled',
          ),
      ).toBe(true),
    )
    await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
    await screen.findByText('Сохранённый возврат')
    expect(postBody<ReturnCreate>(post, 1)).toEqual(postBody<ReturnCreate>(post))
  })
})
