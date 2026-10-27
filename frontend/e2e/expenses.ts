import { expect, type Page } from '@playwright/test'
import type { components } from '../src/api/schema.js'
import { todayLocal } from '../src/lib/dates.js'
import { getJson } from './snap.js'
import { Actions } from './actions.js'

type Expense = components['schemas']['ExpenseBatch']['items'][number]
type Summary = components['schemas']['SummaryOut']

export async function addExpense(page: Page) {
  await page.goto('/expenses')
  const actions = new Actions()
  await actions.click(page.getByRole('button', { name: 'Шығыс қосу', exact: true }))
  const dialog = page.getByRole('dialog')
  await actions.click(dialog.getByRole('button', { name: 'Жалдау ақысы', exact: true }))
  await actions.fill(dialog.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }), '100000')
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/expenses') && response.request().method() === 'POST',
  )
  await actions.click(dialog.getByRole('button', { name: 'Сақтау', exact: true }))
  const saved = (await (await response).json()).items[0] as Expense
  await expect(dialog).toHaveCount(0)
  actions.check('expense')
  expect(actions.count).toBe(4)
  return saved
}

export async function expenseReport(page: Page, day: string): Promise<Summary> {
  return getJson<Summary>(page, `/api/reports/summary?from=${day}&to=${day}`)
}

export async function isolatedExpenseReport(page: Page, expense: Expense) {
  // Each width uses its own old day; parallel sales and expenses use today's date.
  const day = page.viewportSize()!.width === 1366 ? '2026-05-12' : '2026-05-13'
  const created = await page.request.post('/api/expenses', {
    data: {
      request_id: crypto.randomUUID(),
      items: [
        {
          expense_date: day,
          category: 'rent',
          amount: expense.amount,
          note: `E2E-${page.viewportSize()!.width}`,
        },
      ],
    },
  })
  expect(created.status()).toBe(201)
  const item = (await created.json()).items[0] as Expense
  await page.goto(`/report?from=${day}&to=${day}`)
  const steps = page.getByTestId('profit-steps')
  await expect(steps.getByText('Шығыстар', { exact: true })).toBeVisible()
  await expect(steps.getByTestId('profit-after-expenses')).toContainText('-100')
  expect((await expenseReport(page, day)).profit_after_expenses).toBe(-expense.amount)
  await steps.getByRole('link', { name: 'Көрсету', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`expenses.*from=${day}`))
  const row = page
    .locator('[data-row-key]')
    .filter({ visible: true })
    .filter({ hasText: `E2E-${page.viewportSize()!.width}` })
  await row.getByRole('button', { name: 'Шығыстың күшін жою', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Қате енгізілді', exact: true }).click()
  await dialog.getByRole('button', { name: 'Шығыстың күшін жою', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row).toContainText('Күші жойылды')
  const result = await expenseReport(page, day)
  expect(result.expenses_total).toBe(0)
  expect(result.profit_after_expenses).toBe(0)
  await page.goto(`/report?from=${day}&to=${day}`)
  await expect(page.getByTestId('profit-steps')).toHaveCount(0)
  // Keep the original budget document visible in the demo; its date was today's Almaty day.
  expect(item.id).not.toBe(expense.id)
  expect(expense.expense_date).toBe(todayLocal())
}
