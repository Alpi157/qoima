import { screen, waitFor, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import { draftKey } from '../../components/flow'
import { formatMoney } from '../../lib/money'
import { makeProduct, makeReceipt, ok } from '../../test/fixtures'
import { mockFlowGet, postBody } from '../../test/flowApi'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { ReceiptCreate, ReceiptWarning } from '../receipts/api'
import { ReceivePage } from './ReceivePage'
import { createReceiptDraft, emptyRate, receiptBody, type ReceiptDraft } from './receiptDraft'
import { receiptWarningText } from './receiptWarningText'

afterEach(() => vi.restoreAllMocks())
const product = makeProduct({ id: 7, article: 'FX', sale_price: 1400000 })
const key = draftKey(1, 'receipt')
function draft(overrides: Partial<ReceiptDraft> = {}) {
  const value = {
    ...createReceiptDraft(),
    lines: [{ productId: 7, qty: 1, cost: '100', priceCurrency: 'KZT' as const }],
    ...overrides,
  }
  localStorage.setItem(key, JSON.stringify(value))
  return value
}
function mount(route = '/receive') {
  return renderWithDataRouter(
    [
      { path: '/receive', element: <ReceivePage /> },
      { path: '/receive/done/:id', element: <p>Done</p> },
    ],
    { route },
  )
}
function rates() {
  const get = mockFlowGet({ products: [product] })
  const original = get.getMockImplementation()! as unknown as (
    path: string,
    init: unknown,
  ) => unknown
  get.mockImplementation(((
    path: string,
    init: { params?: { query?: { currency?: string; date?: string } } },
  ) =>
    path === '/api/rates'
      ? ok({
          currency: init.params?.query?.currency,
          requested_date: init.params?.query?.date,
          rate_date: '2026-10-17',
          rate: init.params?.query?.currency === 'USD' ? '452.1200' : '67.6200',
          exact: false,
          source: 'nbk',
        })
      : original(path, init)) as never)
  return get
}
const costWarning: ReceiptWarning = {
  code: 'cost_not_below_price',
  key: 'cost_not_below_price:7:1400000:1400000',
  params: { product_id: 7, article: 'FX', unit_cost: 1400000, sale_price: 1400000 },
}

it('KZT 409 displays warnings and the next click sends their exact keys', async () => {
  rates()
  draft()
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValueOnce(
      new ApiError(409, 'detail', {}, 'receipt_warnings', { warnings: [costWarning] }),
    )
    .mockReturnValueOnce(ok(makeReceipt()))
  const user = setupUser()
  mount()
  await screen.findByRole('textbox', { name: 'Количество FX' })
  await user.click(await screen.findByRole('button', { name: 'Добавить на склад' }))
  expect(await screen.findByTestId('receipt-warnings')).toBeTruthy()
  expect(postBody<ReceiptCreate>(post).confirmed_warnings).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Да, всё верно, сохранить' }))
  await screen.findByText('Done')
  expect(postBody<ReceiptCreate>(post, 1)).toEqual({
    ...postBody<ReceiptCreate>(post),
    confirmed_warnings: [costWarning.key],
  })
})

it('unknown does not fetch or replace its nbk rate and replays the same body after reload', async () => {
  const get = rates()
  const original = draft({
    currency: 'CNY',
    rate: { ...emptyRate(), value: '70.0000', date: '2026-10-16', source: 'nbk' },
  })
  const body = { ...receiptBody(original), confirmed_warnings: ['already-shown'] }
  localStorage.setItem(key, JSON.stringify({ ...original, unknown: true, lastBody: body }))
  const post = vi.spyOn(api, 'POST').mockRejectedValue(networkError())
  const first = mount()
  const user = setupUser()
  await screen.findByTestId('unknown-result')
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Курс, ₸' })).toBeTruthy())
  expect((get.mock.calls as unknown[][]).filter(([path]) => path === '/api/rates')).toHaveLength(0)
  expect((screen.getByRole('textbox', { name: 'Курс, ₸' }) as HTMLInputElement).value).toBe(
    '70.0000',
  )
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(postBody<ReceiptCreate>(post)).toEqual(body)
  first.unmount()
  mount()
  await screen.findByTestId('unknown-result')
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(postBody<ReceiptCreate>(post, 1)).toEqual(body)
})

it('changing manual CNY to USD resets the rate to nbk USD even with an unknown result', async () => {
  rates()
  draft({
    unknown: true,
    currency: 'CNY',
    currencyChosen: true,
    rate: { ...emptyRate(), source: 'manual', value: '80', edited: true },
  })
  const user = setupUser()
  mount()
  await user.click(await screen.findByRole('button', { name: '$ Доллар' }))
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Курс, ₸' }) as HTMLInputElement).value).toBe(
      '452.1200',
    ),
  )
  const stored = JSON.parse(localStorage.getItem(key)!) as ReceiptDraft
  expect(receiptBody(stored)).toMatchObject({
    currency: 'USD',
    exchange_rate: '452.1200',
    rate_source: 'nbk',
    rate_date: '2026-10-17',
  })
  expect(await screen.findByText('Цена введена в другой валюте, проверьте')).toBeTruthy()
  await fill(user, screen.getByRole('textbox', { name: 'Закупочная цена FX' }), '101')
  expect(screen.queryByText('Цена введена в другой валюте, проверьте')).toBeNull()
})

it.each(['kk', 'ru'] as const)(
  'formats all warnings with tiyn-aware money in %s',
  async (language) => {
    await i18n.changeLanguage(language)
    const t = i18n.t
    const jump: ReceiptWarning = {
      code: 'cost_jump',
      key: 'jump',
      params: {
        product_id: 7,
        article: 'FX',
        unit_cost: 781250,
        previous_cost: 350025,
        previous_received_at: '2026-10-01T00:00:00Z',
      },
    }
    const rate: ReceiptWarning = {
      code: 'rate_deviation',
      key: 'rate',
      params: {
        target: 'receipt',
        index: null,
        currency: 'CNY',
        rate: '80.0000',
        nbk_rate: '67.6200',
        nbk_rate_date: '2026-10-17',
        nbk_exact: true,
        percent: 18,
      },
    }
    expect(receiptWarningText(jump, t)).toContain(formatMoney(781250))
    expect(receiptWarningText(jump, t)).toContain(formatMoney(350025))
    expect(receiptWarningText(costWarning, t)).toContain(formatMoney(1400000))
    expect(receiptWarningText(rate, t)).toContain('80.0000')
    expect(receiptWarningText(rate, t)).toContain('67.6200')
    expect(receiptWarningText(rate, t)).toContain('17.10.2026')
  },
)

it('a missing rate leaves the input empty and blocks moving forward', async () => {
  const get = rates()
  const normal = get.getMockImplementation()! as unknown as (path: string, init: unknown) => unknown
  get.mockImplementation(((path: string, init: unknown) =>
    path === '/api/rates' ? Promise.reject(networkError()) : normal(path, init)) as never)
  draft({ currency: 'CNY' })
  mount()
  expect(
    await screen.findByText('Не удалось получить курс Нацбанка. Введите курс вручную.'),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Далее' }).hasAttribute('disabled')).toBe(true)
})

it('seeds manual shares from the prior method, then keeps them on amount and line changes', async () => {
  const second = makeProduct({ id: 8, article: 'SECOND' })
  const third = makeProduct({ id: 9, article: 'THIRD' })
  mockFlowGet({ products: [product, second, third] })
  const post = vi.spyOn(api, 'POST').mockImplementation(((
    _path: string,
    init: { body: { expenses: { amount_minor: number; allocation_method: string }[] } },
  ) => {
    const expense = init.body.expenses[0]
    return ok({
      expenses: [
        {
          amount_tiyn: expense.amount_minor,
          allocations: [
            { product_id: 7, amount_tiyn: 6000 },
            { product_id: 8, amount_tiyn: 4000 },
          ],
        },
      ],
    })
  }) as never)
  draft({
    lines: [
      { productId: 7, article: 'FX', qty: 1, cost: '100', priceCurrency: 'KZT' },
      { productId: 8, article: 'SECOND', qty: 1, cost: '100', priceCurrency: 'KZT' },
    ],
    expensesOpen: true,
    expenses: [
      {
        id: 'fee',
        kind: 'delivery',
        amount: '100',
        currency: 'KZT',
        rate: emptyRate(),
        method: 'quantity',
        productIds: [],
        manual: {},
        moreOpen: true,
      },
    ],
  })
  mount()
  const user = setupUser()
  const expense = await screen.findByTestId('receipt-expense')
  await user.click(within(expense).getByRole('combobox', { name: 'Раскладка расхода' }))
  await user.click(screen.getByRole('option', { name: 'Вручную' }))
  await waitFor(() =>
    expect(
      (within(expense).getByRole('textbox', { name: 'FX, ₸' }) as HTMLInputElement).value,
    ).toBe('60'),
  )
  expect(
    (within(expense).getByRole('textbox', { name: 'SECOND, ₸' }) as HTMLInputElement).value,
  ).toBe('40')
  expect(
    postBody<{ expenses: { allocation_method: string }[] }>(post).expenses[0].allocation_method,
  ).toBe('quantity')
  const expenseAmount = within(expense).getByRole('textbox', { name: 'Сумма' })
  await user.clear(expenseAmount)
  await fill(user, expenseAmount, '150')
  await waitFor(() =>
    expect(within(expense).getByTestId('expense-allocation-total').textContent).toContain(
      '100\u00a0₸ / 150\u00a0₸',
    ),
  )
  expect((within(expense).getByRole('textbox', { name: 'FX, ₸' }) as HTMLInputElement).value).toBe(
    '60',
  )
  expect(screen.getByRole('button', { name: 'Далее' }).hasAttribute('disabled')).toBe(true)
  await fill(user, screen.getByRole('searchbox'), 'THIRD')
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(
      (within(expense).getByRole('textbox', { name: 'THIRD, ₸' }) as HTMLInputElement).value,
    ).toBe('0'),
  )
  const saved = JSON.parse(localStorage.getItem(key)!) as ReceiptDraft
  expect(saved.expenses[0].manual).toEqual({ 7: '60', 8: '40', 9: '0' })
})

it('failed manual seeding keeps fields empty and retry seeds from the original method', async () => {
  rates()
  let fail = true
  vi.spyOn(api, 'POST').mockImplementation(((
    _path: string,
    init: { body: { expenses: { allocation_method: string }[] } },
  ) => {
    if (init.body.expenses[0].allocation_method === 'amount' && fail)
      return Promise.reject(networkError())
    return ok({
      expenses: [{ amount_tiyn: 10000, allocations: [{ product_id: 7, amount_tiyn: 10000 }] }],
    })
  }) as never)
  draft({
    expensesOpen: true,
    expenses: [
      {
        id: 'fee',
        kind: 'delivery',
        amount: '100',
        currency: 'KZT',
        rate: emptyRate(),
        method: 'amount',
        productIds: [],
        manual: {},
        moreOpen: true,
      },
    ],
  })
  mount()
  const user = setupUser()
  const expense = await screen.findByTestId('receipt-expense')
  await user.click(within(expense).getByRole('combobox', { name: 'Раскладка расхода' }))
  await user.click(screen.getByRole('option', { name: 'Вручную' }))
  await screen.findByRole('button', { name: 'Загрузить ещё раз' })
  expect((within(expense).getByRole('textbox', { name: 'FX, ₸' }) as HTMLInputElement).value).toBe(
    '',
  )
  fail = false
  await user.click(within(expense).getByRole('button', { name: 'Загрузить ещё раз' }))
  await waitFor(() =>
    expect(
      (within(expense).getByRole('textbox', { name: 'FX, ₸' }) as HTMLInputElement).value,
    ).toBe('100'),
  )
})

it('defaults follow the supplier until the user selects a currency', async () => {
  const get = rates()
  const normal = get.getMockImplementation()! as unknown as (path: string, init: unknown) => unknown
  get.mockImplementation(((path: string, init: { params?: { query?: { supplier?: string } } }) =>
    path === '/api/receipts/defaults'
      ? ok({ currency: init.params?.query?.supplier ? 'USD' : 'CNY', source: 'supplier' })
      : normal(path, init)) as never)
  mount()
  const user = setupUser()
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Курс, ₸' }) as HTMLInputElement).value).toBe(
      '67.6200',
    ),
  )
  await user.click(screen.getByRole('button', { name: 'Дополнительно' }))
  await fill(user, screen.getByRole('textbox', { name: 'Поставщик' }), 'USD supplier')
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Курс, ₸' }) as HTMLInputElement).value).toBe(
      '452.1200',
    ),
  )
  await user.click(screen.getByRole('button', { name: '₸ Тенге' }))
  await fill(user, screen.getByRole('textbox', { name: 'Поставщик' }), 'Another supplier')
  expect(screen.getByRole('button', { name: '₸ Тенге' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('textbox', { name: 'Курс, ₸' })).toBeNull()
})

it('preview nbk mismatch refreshes the rate and leaves a notice and the original lines', async () => {
  rates()
  draft({ currency: 'CNY', rate: { ...emptyRate(), value: '70', date: '2026-10-17' } })
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError(422, 'detail', {}, 'nbk_rate_mismatch', {
      currency: 'CNY',
      rate_date: '2026-10-17',
    }),
  )
  mount()
  const user = setupUser()
  await screen.findByRole('textbox', { name: 'Количество FX' })
  await user.click(screen.getByRole('button', { name: 'Далее' }))
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Курс, ₸' }) as HTMLInputElement).value).toBe(
      '67.6200',
    ),
  )
  expect(
    await screen.findByText('Курс Нацбанка, похоже, изменился. Курс обновлён, проверьте.'),
  ).toBeTruthy()
  expect(
    (screen.getByRole('textbox', { name: 'Закупочная цена FX' }) as HTMLInputElement).value,
  ).toBe('100')
})

it('explicitly restoring nbk works while the result is unknown', async () => {
  rates()
  draft({
    unknown: true,
    currency: 'CNY',
    rate: { ...emptyRate(), value: '80', source: 'manual', edited: true },
  })
  mount()
  const user = setupUser()
  await user.click(await screen.findByRole('button', { name: 'Вернуть курс Нацбанка' }))
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Курс, ₸' }) as HTMLInputElement).value).toBe(
      '67.6200',
    ),
  )
  expect((JSON.parse(localStorage.getItem(key)!) as ReceiptDraft).rate.source).toBe('nbk')
})

it('an empty restored document cannot remain on the review URL', async () => {
  rates()
  draft({
    lines: [],
    currency: 'CNY',
    rate: { ...emptyRate(), value: '67.6200', date: '2026-10-17' },
  })
  const { router } = mount('/receive?step=review')
  await screen.findByRole('heading', { name: 'Какой товар пришёл?' })
  await waitFor(() => expect(router.state.location.search).toBe(''))
})
