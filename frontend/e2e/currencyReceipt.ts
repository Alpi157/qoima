import { expect, type Page } from '@playwright/test'
import type { components } from '../src/api/schema.js'
import { Actions } from './actions.js'
import { getJson } from './snap.js'

type Product = components['schemas']['ProductOut']
export type Receipt = components['schemas']['ReceiptOut']
export const currencyTexts = {
  kk: {
    search: 'Артикулды немесе атауын жазыңыз',
    qty: (article: string) => `${article} саны`,
    cost: (article: string) => `${article} сатып алу бағасы`,
    addExpense: 'Шығын қосу',
    delivery: 'Жеткізу',
    duty: 'Кеден төлемі',
    amount: 'Сомасы',
    next: 'Келесі',
    review: 'Тексеріңіз',
    save: 'Сақтау',
    done: 'Тауар қоймаға қосылды',
    history: 'Сатып алу тарихы',
    confirm: 'Иә, дұрыс, сақтау',
    retry: 'Қайта тексеру',
  },
  ru: {
    search: 'Напишите артикул или название',
    qty: (article: string) => `Количество ${article}`,
    cost: (article: string) => `Закупочная цена ${article}`,
    addExpense: 'Добавить расход',
    delivery: 'Доставка',
    duty: 'Таможенная пошлина',
    amount: 'Сумма',
    next: 'Далее',
    review: 'Проверьте',
    save: 'Сохранить',
    done: 'Товар добавлен на склад',
    history: 'История закупок',
    confirm: 'Да, всё верно, сохранить',
    retry: 'Проверить ещё раз',
  },
}
export async function currencyProducts(page: Page) {
  const products: Product[] = []
  for (const [index, sale_price] of [1400000, 350000].entries()) {
    const response = await page.request.post('/api/products', {
      data: {
        article: `FX26B-${page.viewportSize()!.width}-${crypto.randomUUID().slice(0, 8)}-${index}`,
        name: `Валютный приём ${index + 1}`,
        sale_price,
      },
    })
    expect(response.status()).toBe(201)
    products.push((await response.json()) as Product)
  }
  return products
}
export async function currencyLanguage(page: Page, language: 'kk' | 'ru') {
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), locale: language } })
  })
  await page.evaluate((language) => localStorage.setItem('qoima.language', language), language)
}
export async function fillCurrencyReceipt(
  page: Page,
  products: Product[],
  language: 'kk' | 'ru' = 'kk',
) {
  const text = currencyTexts[language]
  await page.goto('/receive')
  const actions = new Actions()
  await actions.click(page.getByRole('button', { name: '¥ Юань', exact: true }))
  await expect(page.getByRole('textbox', { name: 'Курс, ₸' })).toHaveValue('67.6200')
  for (const [index, product] of products.entries()) {
    await actions.fill(page.getByRole('searchbox'), product.article)
    await actions.enter(page.getByRole('searchbox'))
    await actions.fill(
      page.getByRole('textbox', { name: text.qty(product.article), exact: true }),
      index ? '200' : '100',
    )
    await actions.fill(
      page.getByRole('textbox', { name: text.cost(product.article), exact: true }),
      index ? '25' : '100',
    )
  }
  await actions.click(page.getByRole('button', { name: text.addExpense, exact: true }))
  for (const [kind, amount] of [
    [text.delivery, '105000'],
    [text.duty, '52500'],
  ]) {
    await actions.click(page.getByRole('button', { name: kind, exact: true }))
    const amountInput = page
      .getByTestId('receipt-expense')
      .last()
      .getByRole('textbox', { name: text.amount, exact: true })
    await expect(amountInput).toBeFocused()
    await expect(amountInput).toBeInViewport()
    await actions.fill(amountInput, amount)
  }
  return actions
}
export async function verifyCurrencyReview(page: Page) {
  await expect(page.getByTestId('currency-receipt-total')).toContainText(
    '1\u00a0171\u00a0800\u00a0₸',
  )
  const chains = page.getByTestId('receipt-cost-chain')
  await expect(chains).toHaveCount(2)
  await expect(chains.nth(0)).toContainText('7\u00a0812\u00a0₸')
  await expect(chains.nth(1)).toContainText('1\u00a0953\u00a0₸')
  await expect(chains.nth(0)).toContainText('6\u00a0762\u00a0₸')
  await expect(chains.nth(1)).toContainText('1\u00a0690,50\u00a0₸')
}
export async function verifySavedCurrency(
  page: Page,
  receipt: Receipt,
  products: Product[],
  language: 'kk' | 'ru',
) {
  expect(receipt).toMatchObject({
    currency: 'CNY',
    goods_total: 101430000,
    expenses_total: 15750000,
    total_cost: 117180000,
  })
  expect(receipt.lines.map((line) => line.unit_cost)).toEqual([781200, 195300])
  await page.goto(`/receipts/${receipt.id}`)
  await expect(page.getByText(/1\s171\s800/).last()).toBeVisible()
  const history = await getJson<components['schemas']['ProductPurchasePage']>(
    page,
    `/api/products/${products[0].id}/purchases`,
  )
  expect(history.items[0]).toMatchObject({
    receipt_id: receipt.id,
    unit_cost: 781200,
    total: 78120000,
  })
  await page.goto(`/products/${products[0].id}`)
  const section = page
    .getByRole('heading', { name: currencyTexts[language].history, exact: true })
    .locator('..')
  await expect(
    section.getByText('67.6200', { exact: false }).filter({ visible: true }).first(),
  ).toBeVisible()
  await expect(section.locator(`a[href="/receipts/${receipt.id}"]:visible`).first()).toBeVisible()
}
