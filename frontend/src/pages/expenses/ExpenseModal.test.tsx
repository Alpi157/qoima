import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import dayjs from 'dayjs'
import { api } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import { fieldError, makeBusinessSettings, ok } from '../../test/fixtures'
import { postBody } from '../../test/flowApi'
import { renderWithDataRouter, renderWithProviders } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import { todayLocal } from '../../lib/dates'
import { ExpenseModal } from './ExpenseModal'
import { ExpensesPage } from './ExpensesPage'
import type { Expense, ExpenseCreate } from './api'

const item: Expense = {
  id: 1,
  number: 7,
  expense_date: '2026-09-30',
  category: 'rent',
  amount: 10000,
  note: 'Офис',
  status: 'posted',
  created_at: '2026-09-30T10:00:00Z',
  created_by_name: 'Владелец',
  cancelled_at: null,
  cancelled_by_name: null,
  cancel_reason: null,
}
afterEach(() => {
  vi.restoreAllMocks()
})
function settings(tax = '0', commission = '0') {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    path === '/api/settings'
      ? ok(makeBusinessSettings({ tax_percent: tax, card_commission_percent: commission }))
      : ok({ items: [], total: 0, posted_amount: 0 })) as never)
}
function renderModal(source?: Expense[]) {
  const close = vi.fn()
  renderWithProviders(<ExpenseModal opened onClose={close} source={source} />)
  return close
}
async function complete() {
  const user = setupUser()
  await user.click(screen.getByRole('button', { name: 'Аренда' }))
  await fill(user, screen.getByRole('textbox', { name: 'Сумма, ₸' }), '100')
  return user
}

it.each(['kk', 'ru', 'zh'])(
  'starts with no category and preserves entered fields on category validation in %s',
  async (language) => {
    await i18n.changeLanguage(language)
    settings()
    const post = vi.spyOn(api, 'POST')
    renderModal()
    const user = setupUser()
    const buttons = within(
      screen.getByRole('group', { name: i18n.t('expenses.category') }),
    ).getAllByRole('button')
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
    const amount = screen.getByRole('textbox', { name: i18n.t('expenses.amount') })
    const note = screen.getByRole('textbox', { name: i18n.t('expenses.note') })
    fireEvent.change(amount, { target: { value: '123,45' } })
    fireEvent.change(note, { target: { value: 'Офис' } })
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('expenses.categoryRequired'))
    expect(
      screen.getByRole('group', { name: i18n.t('expenses.category') }).getAttribute('aria-invalid'),
    ).toBe('true')
    expect(
      (screen.getByRole('textbox', { name: i18n.t('expenses.amount') }) as HTMLInputElement).value,
    ).toBe('123,45')
    expect(
      (screen.getByRole('textbox', { name: i18n.t('expenses.note') }) as HTMLInputElement).value,
    ).toBe('Офис')
    expect(post).not.toHaveBeenCalled()
  },
)

it.each([
  ['0', '0'],
  ['3', '1'],
])('shows tax and bank hints only for nonzero settings %s/%s', async (tax, commission) => {
  settings(tax, commission)
  renderModal()
  const user = setupUser()
  await user.click(screen.getByRole('button', { name: 'Налоги и взносы' }))
  if (tax === '0') expect(screen.queryByText(/Налог уже считается/)).toBeNull()
  else expect(await screen.findByText(/Налог уже считается/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Банк' }))
  expect(screen.queryByText(/Налог уже считается/)).toBeNull()
  if (commission === '0') expect(screen.queryByText(/Комиссия за карту уже/)).toBeNull()
  else expect(await screen.findByText(/Комиссия за карту уже/)).toBeTruthy()
  expect(screen.getByText(/Доставку от поставщика/)).toBeTruthy()
})

it('saves one expense with the Almaty date and normalized note', async () => {
  settings()
  const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ items: [item] }))
  const close = renderModal()
  const user = await complete()
  await fill(user, screen.getByRole('textbox', { name: 'Заметка' }), '  офис  ')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(postBody<ExpenseCreate>(post)).toEqual({
    request_id: expect.any(String),
    items: [{ expense_date: todayLocal(), category: 'rent', amount: 10000, note: 'офис' }],
  })
})

it('keeps input on a server date error and disables tomorrow in the calendar', async () => {
  settings()
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError(
      422,
      'Invalid',
      { 'items.0.expense_date': fieldError('Future', 'expense_date_in_future') },
      'validation_error',
    ),
  )
  renderModal()
  const user = await complete()
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText('Нельзя выбрать будущую дату.')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'Сумма, ₸' }) as HTMLInputElement).value).toBe('100')
  await user.click(screen.getByLabelText(/Дата/))
  const tomorrow = new Date(`${todayLocal()}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const nextDay = screen.getByRole('button', {
    name: dayjs(tomorrow).locale('en').format('D MMMM YYYY'),
  }) as HTMLButtonElement
  expect(nextDay.disabled).toBe(true)
})

it('retries the exact body after an unknown result', async () => {
  settings()
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValueOnce(networkError())
    .mockReturnValueOnce(ok({ items: [item] }))
  const close = renderModal()
  const user = await complete()
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByTestId('unknown-result')
  expect(screen.getByRole('textbox', { name: 'Сумма, ₸' }).matches(':disabled')).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(postBody<ExpenseCreate>(post, 1)).toEqual(postBody<ExpenseCreate>(post))
})

it('shows the conflict and generates a new UUID only after clear', async () => {
  settings()
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValue(
      new ApiError(409, 'Conflict', {}, 'expense_request_conflict', { id: 17, number: 9 }),
    )
  renderModal()
  const user = await complete()
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect((await screen.findByTestId('request-conflict')).textContent).toContain('№9')
  await user.click(screen.getByRole('button', { name: 'Очистить' }))
  await complete()
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(postBody<ExpenseCreate>(post, 1).request_id).not.toBe(
    postBody<ExpenseCreate>(post).request_id,
  )
})

it('copies categories and notes, excludes unchecked rows, and repeats the fixed body after a lost response', async () => {
  settings()
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValueOnce(networkError())
    .mockReturnValueOnce(ok({ items: [item] }))
  renderModal([item, { ...item, id: 2, number: 8, category: 'salary' }])
  const user = setupUser()
  await screen.findAllByRole('checkbox')
  await user.click(screen.getAllByRole('checkbox')[1])
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByTestId('unknown-result')
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(postBody<ExpenseCreate>(post).items).toEqual([
    { expense_date: todayLocal(), category: 'rent', amount: 10000, note: 'Офис' },
  ])
  expect(postBody<ExpenseCreate>(post, 1)).toEqual(postBody<ExpenseCreate>(post))
})

it.each(['kk', 'ru', 'zh'])(
  'blocks more than 20 selected rows without losing dates in %s',
  async (language) => {
    await i18n.changeLanguage(language)
    settings()
    const post = vi.spyOn(api, 'POST')
    renderModal(
      Array.from({ length: 21 }, (_, index) => ({ ...item, id: index + 1, number: index + 1 })),
    )
    await screen.findAllByRole('checkbox')
    expect(
      within(screen.getByTestId('expense-actions')).getByText(i18n.t('expenses.repeatLimit')),
    ).toBeTruthy()
    const save = screen.getByRole('button', { name: i18n.t('common.save') }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(post).not.toHaveBeenCalled()
    await setupUser().click(screen.getAllByRole('checkbox')[0])
    expect(save.disabled).toBe(false)
    expect(screen.queryByText(i18n.t('expenses.repeatLimit'))).toBeNull()
    expect(
      screen.getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked),
    ).toHaveLength(20)
  },
)

it('hides repeat without posted rent or salary in the previous calendar month', async () => {
  vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [], total: 0, posted_amount: 0 }))
  renderWithDataRouter([{ path: '/expenses', element: <ExpensesPage /> }], { route: '/expenses' })
  await screen.findByText('За этот период расходов нет.')
  expect(
    screen.queryByRole('button', { name: 'Повторить аренду и зарплату прошлого месяца' }),
  ).toBeNull()
})

it('opens an expense from a conflict even when its date is outside the displayed period', async () => {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    path === '/api/settings'
      ? ok(makeBusinessSettings())
      : path === '/api/expenses/{expense_id}'
        ? ok({ ...item, id: 17, number: 9 })
        : ok({ items: [], total: 0, posted_amount: 0 })) as never)
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError(409, 'Conflict', {}, 'expense_request_conflict', { id: 17, number: 9 }),
  )
  const { router } = renderWithDataRouter([{ path: '/expenses', element: <ExpensesPage /> }], {
    route: '/expenses?from=2026-10-01&to=2026-10-27',
  })
  const user = setupUser()
  await user.click(await screen.findByRole('button', { name: 'Добавить расход' }))
  await complete()
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByTestId('request-conflict')
  await user.click(screen.getByRole('button', { name: 'Открыть' }))
  expect((await screen.findByTestId('focused-expense')).textContent).toContain('№9')
  expect(router.state.location.search).toContain('expenseFocus=17')
})

it('unchecks recorded repeats, shows source date and permits explicit repetition', async () => {
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    path === '/api/settings'
      ? ok(makeBusinessSettings())
      : ok({
          items: [{ ...item, expense_date: todayLocal() }],
          total: 1,
          posted_amount: item.amount,
        })) as never)
  const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ items: [item] }))
  renderModal([item])
  const box = (await screen.findByRole('checkbox')) as HTMLInputElement
  expect(box.checked).toBe(false)
  expect(screen.getByText('Уже записан в этом месяце')).toBeTruthy()
  expect(screen.getByText(/30.09.2026/)).toBeTruthy()
  expect(screen.queryByText(/№7/)).toBeNull()
  const user = setupUser()
  await user.click(box)
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(post).toHaveBeenCalled())
  expect(postBody<ExpenseCreate>(post).items[0].amount).toBe(item.amount)
})

it('uses the reviewed Kazakh purchase hint', async () => {
  await i18n.changeLanguage('kk')
  settings()
  renderModal()
  expect(
    screen.getByText(
      'Жеткізу, кеден төлемі және брокер шығындарын мұнда емес, тауар қабылдағанда жазыңыз.',
    ),
  ).toBeTruthy()
})
