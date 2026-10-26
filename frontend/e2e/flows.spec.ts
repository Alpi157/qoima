import { expect, type Page, test } from '@playwright/test'

import { getJson, login, settle, snap } from './snap.js'
import { REPORT_MODULE } from './pageModules.js'
import { todayLocal } from '../src/lib/dates.js'
import { formatMoney } from '../src/lib/money.js'
import type { components } from '../src/api/schema.js'
import {
  currencyProducts,
  currencyLanguage,
  fillCurrencyReceipt,
  verifyCurrencyReview,
  verifySavedCurrency,
  currencyTexts,
  type Receipt as CurrencyReceipt,
} from './currencyReceipt.js'

test.beforeEach(async ({ page }) => {
  // Each page owns its default: parallel currency scenarios must not change the KZT budget.
  await page.route('**/api/receipts/defaults*', (route) =>
    route.fulfill({ json: { currency: 'KZT', source: 'default' } }),
  )
})

for (const language of ['kk', 'ru'] as const) {
  test(`currency receipt: reference 1 and action budget ${language}`, async ({ page }) => {
    await login(page)
    if (page.viewportSize()!.width === 1366)
      await page.setViewportSize({ width: 1366, height: 768 })
    await currencyLanguage(page, language)
    const products = await currencyProducts(page)
    const actions = await fillCurrencyReceipt(page, products, language)
    const text = currencyTexts[language]
    await actions.click(page.getByRole('button', { name: text.next, exact: true }))
    await expect(page.getByRole('heading', { name: text.review, exact: true })).toBeVisible()
    await verifyCurrencyReview(page)
    const savedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/receipts') && response.request().method() === 'POST',
    )
    await actions.click(page.getByRole('button', { name: text.save, exact: true }))
    const receipt = (await (await savedResponse).json()) as CurrencyReceipt
    await expect(page.getByRole('heading', { name: text.done, exact: true })).toBeVisible()
    actions.check('currencyReceipt')
    expect(actions.count).toBe(16)
    await verifySavedCurrency(page, receipt, products, language)
  })
  test(`currency receipt: manual rate warning confirmation ${language}`, async ({ page }) => {
    await login(page)
    await currencyLanguage(page, language)
    const products = await currencyProducts(page)
    await fillCurrencyReceipt(page, products, language)
    await page.getByRole('textbox', { name: 'Курс, ₸' }).fill('80')
    const text = currencyTexts[language]
    await page.getByRole('button', { name: text.next, exact: true }).click()
    await expect(page.getByTestId('receipt-warnings')).toContainText('80.0000')
    await expect(page.getByTestId('receipt-warnings')).toContainText('67.6200')
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/receipts') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: text.confirm, exact: true }).click()
    const result = await response
    expect(result.status()).toBe(201)
    const body = result.request().postDataJSON() as components['schemas']['ReceiptCreate']
    expect(body.confirmed_warnings?.some((key) => key.startsWith('rate_deviation:receipt:'))).toBe(
      true,
    )
    await expect(page.getByRole('heading', { name: text.done, exact: true })).toBeVisible()
  })
}
for (const accepted of [true, false]) {
  test(`draft safety currency receipt: ${accepted ? 'accepted response lost' : 'request aborted before server'} and reload`, async ({
    page,
  }) => {
    await login(page)
    const products = await currencyProducts(page)
    await fillCurrencyReceipt(page, products)
    await page.getByRole('button', { name: 'Келесі', exact: true }).click()
    await verifyCurrencyReview(page)
    const bodies: components['schemas']['ReceiptCreate'][] = []
    await page.route('**/api/receipts', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      bodies.push(route.request().postDataJSON() as components['schemas']['ReceiptCreate'])
      if (bodies.length === 1) {
        if (accepted) expect((await route.fetch()).status()).toBe(201)
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Сақтау', exact: true }).click()
    await expect(page.getByTestId('unknown-result')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('unknown-result')).toBeVisible()
    await page.getByRole('button', { name: 'Қайта тексеру', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Тауар қоймаға қосылды' })).toBeVisible()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    const history = await getJson<components['schemas']['ProductPurchasePage']>(
      page,
      `/api/products/${products[0].id}/purchases`,
    )
    expect(history.total).toBe(1)
  })
}

type Product = components['schemas']['ProductOut']
type Sale = components['schemas']['SaleOut']
type Customer = components['schemas']['CustomerOut']
type ReturnDocument = components['schemas']['ReturnOut']

// The sale and receiving flows of docs/design/simple-ui.md step by step, on demo data.
// They save a sale and a receiving, so they run after the screens (playwright.config.ts).

const SEARCH = 'Артикулды немесе атауын жазыңыз'

for (const alwaysMissing of [false, true]) {
  test(`page module ${alwaysMissing ? 'persistent failure shows a localized error' : 'recovers after one missing request'}`, async ({
    page,
  }) => {
    await login(page)
    await page.goto('/more')
    await settle(page)
    let documents = 0
    let modules = 0
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++
    })
    await page.route(REPORT_MODULE, async (route) => {
      modules++
      if (alwaysMissing || modules === 1)
        await route.fulfill({ status: 404, body: 'Missing module' })
      else await route.continue()
    })
    await page.getByRole('link', { name: 'Есеп', exact: true }).click()
    await expect(
      page.getByRole('heading', {
        name: alwaysMissing ? 'Бағдарлама жаңартылды' : 'Есеп',
        exact: true,
      }),
    ).toBeVisible()
    await settle(page)
    expect(modules).toBeGreaterThanOrEqual(2)
    expect(documents).toBe(1)
    await expect(page.getByRole('banner').getByText('Qoima')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Unexpected Application Error')
    await expect(page.locator('body')).not.toContainText(
      'Failed to fetch dynamically imported module',
    )
    if (alwaysMissing) {
      await expect(page.getByRole('button', { name: 'Жаңарту', exact: true })).toBeInViewport()
    }
  })
}

test('good and defective return and cancellation restore this customer and these products', async ({
  page,
}) => {
  const w = width(page)
  await login(page)
  const products: Product[] = []
  for (const [index, price] of [100000, 200000].entries()) {
    const created = await page.request.post('/api/products', {
      data: {
        article: `RET-173B-${w}-${index}`,
        name: `Қайтаруды тексеру ${w} ${index}`,
        sale_price: price,
      },
    })
    expect(created.ok()).toBeTruthy()
    products.push((await created.json()) as Product)
  }
  const received = await page.request.post('/api/receipts', {
    data: {
      request_id: crypto.randomUUID(),
      lines: products.map((product) => ({
        product_id: product.id,
        qty: 10,
        unit_cost: product.sale_price === 100000 ? 50000 : 100000,
      })),
    },
  })
  expect(received.ok()).toBeTruthy()
  const customerName = `Қайтару тексеру ${w}`
  const created = await page.request.post('/api/customers', { data: { name: customerName } })
  expect(created.ok()).toBeTruthy()
  const customer = (await created.json()) as Customer
  await page.goto('/sell')
  for (const product of products) {
    await addByEnter(page, product.article)
    await page.getByRole('textbox', { name: `${product.article} саны` }).fill('3')
  }
  await page.getByRole('button', { name: 'Келесі: сатып алушы' }).click()
  await expect(page.getByRole('heading', { name: 'Кімге сатамыз?' })).toBeVisible()
  await page.getByRole('searchbox').fill(customerName)
  await page.locator('.flow-choice').filter({ hasText: customerName }).click()
  await page.getByRole('button', { name: 'Қарызға', exact: true }).click()
  const savedSale = page.waitForResponse(
    (response) => response.url().endsWith('/api/sales') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Сатылымды сақтау' }).click()
  const sale = (await (await savedSale).json()) as Sale
  await expect(page.getByRole('heading', { name: 'Сатылым сақталды' })).toBeVisible()
  const debtBefore = (await getJson<Customer>(page, `/api/customers/${customer.id}`)).debt
  const stockBefore = await Promise.all(
    products.map((product) => getJson<Product>(page, `/api/products/${product.id}`)),
  )
  expect(debtBefore).toBe(900000)
  await page.goto(`/sales/${sale.id}`)
  await page.getByRole('link', { name: 'Қайтару', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Не қайтарады?' })).toBeVisible()
  for (const product of products)
    await page.getByRole('textbox', { name: `${product.article} саны` }).fill('1')
  await page.getByRole('button', { name: 'Ақаулы, қоймаға қайтпайды' }).last().click()
  await expect(page.getByTestId('return-credit')).toHaveText(
    `Қарыздан шегеріледі: ${formatMoney(300000)}`,
  )
  await expect(page.getByRole('button', { name: 'Қайтаруды сақтау' })).toBeInViewport()
  await snap(page, 'return-flow-selected', w)
  await snap(page, 'return-flow-selected-screen', w, { fullPage: false })
  const savedReturn = page.waitForResponse(
    (response) => response.url().endsWith('/api/returns') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Қайтаруды сақтау' }).click()
  const document = (await (await savedReturn).json()) as ReturnDocument
  await expect(page.getByRole('heading', { name: `Қайтару №${document.number}` })).toBeVisible()
  expect(document.total).toBe(300000)
  expect(document.lines.map((line) => line.condition)).toEqual(['good', 'defective'])
  expect((await getJson<Customer>(page, `/api/customers/${customer.id}`)).debt).toBe(
    debtBefore - document.total,
  )
  const stockAfter = await Promise.all(
    products.map((product) => getJson<Product>(page, `/api/products/${product.id}`)),
  )
  expect(stockAfter.map((product) => product.stock)).toEqual([
    stockBefore[0].stock + 1,
    stockBefore[1].stock,
  ])
  await snap(page, 'return-flow-card', w)
  await page.goto(`/sales/${sale.id}`)
  const saleAfter = await getJson<Sale>(page, `/api/sales/${sale.id}`)
  expect(saleAfter.lines.map((line) => line.returned_qty)).toEqual([1, 1])
  expect(saleAfter).toMatchObject({
    payment_status: 'unpaid',
    outstanding: debtBefore - document.total,
  })
  if (w === '1366') {
    const table = page.getByRole('table').first()
    await expect(table.getByRole('columnheader', { name: 'Қайтарылды' })).toBeVisible()
    const rows = table.getByRole('row')
    for (const index of [1, 2])
      await expect(rows.nth(index).getByRole('cell').nth(3)).toHaveText('1')
  } else await expect(page.getByText('Қайтарылды: 1', { exact: true })).toHaveCount(2)
  await expect(
    page.getByText(`Төленбеген: ${formatMoney(debtBefore - document.total)}`, { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сатылымның күшін жою' })).toHaveCount(0)
  await snap(page, 'return-flow-sale', w)
  await page.goto(`/customers/${customer.id}`)
  await expect(
    page.getByRole('link', { name: `Қайтару №${document.number}`, exact: true }).first(),
  ).toBeVisible()
  await snap(page, 'return-flow-ledger', w)
  await page.goto(`/returns/${document.id}`)
  await page.getByRole('button', { name: 'Күшін жою', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: 'Қате енгізілді' }).click()
  await snap(page, 'return-cancel-modal', w, { fullPage: false })
  await modal.getByRole('button', { name: 'Күшін жою', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(page.getByText('Қайтарудың күші жойылған', { exact: true })).toBeVisible()
  expect((await getJson<Customer>(page, `/api/customers/${customer.id}`)).debt).toBe(debtBefore)
  const restored = await Promise.all(
    products.map((product) => getJson<Product>(page, `/api/products/${product.id}`)),
  )
  expect(restored.map((product) => product.stock)).toEqual(
    stockBefore.map((product) => product.stock),
  )
  const saleRestored = await getJson<Sale>(page, `/api/sales/${sale.id}`)
  expect(saleRestored.lines.map((line) => line.returned_qty)).toEqual([0, 0])
  expect(saleRestored).toMatchObject({ payment_status: 'unpaid', outstanding: debtBefore })
})

function width(page: Page): string {
  return String(page.viewportSize()!.width)
}

/** Types an article and presses Enter: the first result becomes a line. */
async function addByEnter(page: Page, article: string) {
  await page.getByRole('searchbox', { name: SEARCH }).fill(article)
  await page.getByRole('searchbox', { name: SEARCH }).press('Enter')
  await expect(page.getByRole('textbox', { name: `${article} саны` })).toBeVisible()
}

test('sale in three steps', async ({ page }) => {
  const w = width(page)
  await login(page)

  await page.goto('/sell')
  await expect(page.getByText('Жиі сатылатындар:')).toBeVisible()
  await snap(page, 'sell-1-empty', w)

  await addByEnter(page, 'IKH16TT')
  const decrement = page.getByRole('button', { name: 'Азайту' }).first()
  await expect(decrement).toBeDisabled()
  expect(
    await decrement.evaluate((button) => {
      const style = getComputedStyle(button)
      return [style.backgroundColor, style.color, style.cursor]
    }),
  ).toEqual(['rgb(255, 255, 255)', 'rgb(174, 184, 196)', 'not-allowed'])
  await addByEnter(page, 'IKH20TT')
  // Both widths save this seeded product; use the stock shown by this form.
  await addByEnter(page, '22401-8H515')
  const lowStockCard = page.locator('.flow-line').filter({ hasText: '22401-8H515' })
  const stockText = await lowStockCard.getByText(/^Қоймада: \d+ дана$/).innerText()
  const stock = Number(stockText.match(/\d+/)![0])
  await page.getByRole('textbox', { name: '22401-8H515 саны' }).fill(String(stock + 1))
  await expect(page.getByText(`Қоймада тек ${stock} дана бар. Санын азайтыңыз.`)).toBeVisible()
  await page.getByRole('searchbox', { name: SEARCH }).focus()
  await snap(page, 'sell-1-lines', w)
  // The first screen as the user sees it: on a phone the panel sticks to the bottom.
  await snap(page, 'sell-1-lines-screen', w, { fullPage: false })

  // Coming back to the screen restores the draft.
  await page.reload()
  await expect(page.getByText('Аяқталмаған сатылым қалпына келтірілді.')).toBeVisible()
  await snap(page, 'sell-draft', w)

  await page.getByRole('textbox', { name: '22401-8H515 саны' }).fill('1')
  await page.getByRole('button', { name: 'Келесі: сатып алушы' }).click()
  await expect(page.getByText('Соңғы сатып алушылар')).toBeVisible()
  await snap(page, 'sell-2', w)

  await page.getByRole('button', { name: 'Жаңа сатып алушы' }).click()
  await page.getByRole('textbox', { name: 'Жаңа сатып алушының аты' }).fill('Досжан Әлиев')
  await snap(page, 'sell-2-new-customer', w)
  await page.getByRole('button', { name: 'Бас тарту' }).click()

  await page.locator('.flow-choice').first().click()
  await expect(page.getByRole('heading', { name: 'Тексеріңіз' })).toBeVisible()
  await snap(page, 'sell-3', w)

  await page.getByRole('button', { name: 'Сатылымды сақтау' }).click()
  await expect(page.getByRole('heading', { name: 'Сатылым сақталды' })).toBeVisible()
  await snap(page, 'sell-done', w)
})

test('receiving', async ({ page }) => {
  const w = width(page)
  await login(page)

  await page.goto('/receive')
  await snap(page, 'receive-empty', w)

  await addByEnter(page, 'IKH16TT')
  await addByEnter(page, '15208-65F0E')
  await addByEnter(page, '90915-YZZE1')
  await page.getByRole('button', { name: 'Арттыру' }).first().click()
  await page.getByRole('textbox', { name: 'IKH16TT сатып алу бағасы' }).fill('1500')
  await page.getByRole('searchbox', { name: SEARCH }).focus()
  await snap(page, 'receive-lines', w)
  await snap(page, 'receive-lines-screen', w, { fullPage: false })

  await page.getByRole('searchbox', { name: SEARCH }).fill('K20PR-U11')
  await page.getByRole('button', { name: 'Жаңа тауар ретінде қосу' }).click()
  const form = page.getByTestId('new-product-form')
  await form.getByRole('textbox', { name: 'Атауы' }).fill('Свеча зажигания Denso')
  await form.getByRole('textbox', { name: 'Сату бағасы, ₸' }).fill('1600')
  await snap(page, 'receive-new-product', w)
  await form.getByRole('button', { name: 'Бас тарту' }).click()

  for (const article of ['IKH16TT', '15208-65F0E', '90915-YZZE1'])
    await page.getByRole('textbox', { name: `${article} сатып алу бағасы` }).fill('')
  await page.getByRole('button', { name: 'Қоймаға қосу' }).click()
  const firstCost = page.getByRole('textbox', { name: 'IKH16TT сатып алу бағасы' })
  await expect(firstCost).toBeFocused()
  await expect(firstCost).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Сатып алу бағасын жазыңыз', { exact: true })).toHaveCount(3)
  await snap(page, 'receive-cost-required', w, { fullPage: false, preserveScroll: true })
  await page.getByRole('button', { name: 'Қосымша' }).click()
  await page.getByRole('textbox', { name: 'Жеткізуші' }).fill('«Автоимпорт» ЖШС')
  await page.getByRole('textbox', { name: 'IKH16TT сатып алу бағасы' }).fill('1100')
  await page.getByRole('textbox', { name: '15208-65F0E сатып алу бағасы' }).fill('1400')
  await page.getByRole('textbox', { name: '90915-YZZE1 сатып алу бағасы' }).fill('1500')
  await snap(page, 'receive-extras', w)

  await page.getByRole('button', { name: 'Қоймаға қосу' }).click()
  await expect(page.getByRole('heading', { name: 'Тауар қоймаға қосылды' })).toBeVisible()
  await snap(page, 'receive-done', w)
})

test('stock search', async ({ page }) => {
  await login(page)
  await page.goto('/stock?q=IKH')
  await settle(page)
  await snap(page, 'stock-search', width(page))
})

test('partial payment sale and full debt payment', async ({ page }) => {
  const w = width(page)
  const customerName = `Төлем тексеру ${w}`
  await login(page)
  await page.goto('/sell')
  await addByEnter(page, 'IKH16TT')
  await page.getByRole('textbox', { name: 'IKH16TT бағасы' }).fill('1000')
  await page.getByRole('button', { name: 'Келесі: сатып алушы' }).click()
  await page.getByRole('button', { name: 'Жаңа сатып алушы' }).click()
  await page.getByRole('textbox', { name: 'Жаңа сатып алушының аты' }).fill(customerName)
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/customers') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Сақтау және таңдау' }).click()
  const customer = (await (await createdResponse).json()) as { id: number }
  const originalViewport = page.viewportSize()!
  await page.setViewportSize({ width: originalViewport.width, height: w === '1366' ? 768 : 844 })
  await page.getByRole('button', { name: 'Қарызға', exact: true }).click()
  const paidNow = page.getByRole('textbox', { name: 'Қазір қанша төледі, ₸' })
  const remaining = page.getByText(/^Қарызға қалады:/)
  const actions = page.locator('.flow-review-actions')
  const expectPaymentAboveActions = async () => {
    await expect(paidNow).toBeFocused()
    await expect
      .poll(async () => {
        const [fieldBox, remainingBox, panelBox] = await Promise.all([
          paidNow.boundingBox(),
          remaining.boundingBox(),
          actions.boundingBox(),
        ])
        if (!fieldBox || !remainingBox || !panelBox) return null
        return {
          fieldVisible: fieldBox.y >= 0,
          fieldAbovePanel: fieldBox.y + fieldBox.height <= panelBox.y,
          remainingVisible: remainingBox.y >= 0,
          remainingAbovePanel: remainingBox.y + remainingBox.height <= panelBox.y,
          panelSpaceReserved:
            (await page.evaluate(() =>
              parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
            )) >= panelBox.height,
        }
      })
      .toEqual({
        fieldVisible: true,
        fieldAbovePanel: true,
        remainingVisible: true,
        remainingAbovePanel: true,
        panelSpaceReserved: true,
      })
  }
  await expectPaymentAboveActions()
  await snap(page, 'sell-3-debt-focus', w, { fullPage: false, preserveScroll: true })
  // Keyboard focus must also keep the input and the debt above the sticky panel.
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Қарызға', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expectPaymentAboveActions()
  await page.setViewportSize(originalViewport)
  await paidNow.fill('400')
  await expect(page.getByText(`Қарызға қалады: ${formatMoney(60000)}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сатылымды сақтау' })).toBeInViewport()
  await snap(page, 'sell-3-debt-screen', w, { fullPage: false, preserveScroll: true })
  await snap(page, 'sell-3-debt', w)
  const saleResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/sales') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Сатылымды сақтау' }).click()
  const sale = (await (await saleResponse).json()) as {
    id: number
    paid_at_sale: number
    debt_at_sale: number
  }
  expect(sale.paid_at_sale).toBe(40000)
  expect(sale.debt_at_sale).toBe(60000)
  await expect(page.getByRole('heading', { name: 'Сатылым сақталды' })).toBeVisible()
  await expect(page.getByText(`Сатып алушының барлық қарызы: ${formatMoney(60000)}`)).toBeVisible()
  await snap(page, 'sell-done-debt', w)

  await page.goto(`/customers/${customer.id}`)
  await expect(page.getByTestId('customer-debt')).toHaveText(formatMoney(60000))
  await page.getByRole('button', { name: 'Төлем қабылдау' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: /Барлық қарыз:/ }).click()
  await expect(modal.getByRole('textbox', { name: 'Сомасы, ₸' })).toHaveValue('600')
  await modal.getByRole('button', { name: 'Сақтау', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(page.getByText('Қарызы жоқ', { exact: true })).toBeVisible()
  expect((await getJson<{ debt: number }>(page, `/api/customers/${customer.id}`)).debt).toBe(0)
  await expect(page.getByRole('button', { name: 'Төлем қабылдау' })).toHaveCount(0)

  await page.goto('/debts')
  await settle(page)
  await expect(page.getByRole('link', { name: customerName, exact: true })).toHaveCount(0)
  // Check every API page too, so absence cannot be caused by pagination.
  let offset = 0
  let total = 1
  while (offset < total) {
    const data = await getJson<{ items: { id: number }[]; total: number }>(
      page,
      `/api/customers/debts?limit=100&offset=${offset}`,
    )
    expect(data.items.some((row) => row.id === customer.id)).toBe(false)
    total = data.total
    offset += 100
  }

  // Compare the displayed amount with the very response used by this page, not a baseline.
  const summaryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/customers/debts' && url.searchParams.get('limit') === '1'
  })
  await page.goto('/')
  const summary = (await (await summaryResponse).json()) as { total_debt: number }
  if (summary.total_debt === 0) await expect(page.getByTestId('home-debts')).toHaveCount(0)
  else
    await expect(page.getByTestId('home-debts')).toHaveText(
      `Қарыздар: ${formatMoney(summary.total_debt)}`,
    )
})

test('known cost produces 200000 tenge profit for a separate product per width', async ({
  page,
}) => {
  const w = width(page)
  const article = `COST-172B-${w}`
  await login(page)
  await page.goto('/receive')
  await page.getByRole('searchbox', { name: SEARCH }).fill(article)
  await page.getByRole('button', { name: 'Жаңа тауар ретінде қосу' }).click()
  const form = page.getByTestId('new-product-form')
  await form.getByRole('textbox', { name: 'Атауы' }).fill(`Пайда тексеру ${w}`)
  await form.getByRole('textbox', { name: 'Сату бағасы, ₸' }).fill('600000')
  const productResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/products') && response.request().method() === 'POST',
  )
  await form.getByRole('button', { name: 'Сақтау және қосу' }).click()
  const product = (await (await productResponse).json()) as { id: number }
  await page.getByRole('textbox', { name: `${article} саны` }).fill('10')
  await page.getByRole('textbox', { name: `${article} сатып алу бағасы` }).fill('500000')
  await page.getByRole('button', { name: 'Қоймаға қосу' }).click()
  await expect(page.getByRole('heading', { name: 'Тауар қоймаға қосылды' })).toBeVisible()

  await page.goto('/sell')
  await addByEnter(page, article)
  await page.getByRole('textbox', { name: `${article} саны` }).fill('2')
  await page.getByRole('button', { name: 'Келесі: сатып алушы' }).click()
  await page.getByRole('button', { name: 'Сатып алушысыз жалғастыру' }).click()
  await expect(page.getByRole('button', { name: 'Қолма-қол', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const saleResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/sales') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Сатылымды сақтау' }).click()
  expect((await (await saleResponse).json()).payment_method).toBe('cash')
  await expect(page.getByRole('heading', { name: 'Сатылым сақталды' })).toBeVisible()

  const today = todayLocal()
  await page.goto(`/report?from=${today}&to=${today}`)
  await settle(page)
  const row =
    w === '1366'
      ? page.locator('.q-table tbody tr').filter({ hasText: article })
      : page
          .locator('.mantine-Card-root')
          .filter({ has: page.getByText(article, { exact: true }) })
          .filter({ visible: true })
  await expect(row).toHaveCount(1)
  await expect(row.getByText(formatMoney(20000000), { exact: true })).toBeVisible()
  const report = await getJson<{
    items: { product_id: number; qty: number; revenue: number; profit: number }[]
  }>(page, `/api/reports/products?from=${today}&to=${today}&limit=10`)
  expect(report.items.find((item) => item.product_id === product.id)).toMatchObject({
    qty: 2,
    revenue: 120000000,
    profit: 20000000,
  })
  await snap(page, 'report-known-profit', w)
})

test('opening debt, payment and adjustment cancellation produce an overpayment', async ({
  page,
}) => {
  const w = String(page.viewportSize()!.width)
  await login(page)
  await page.goto('/customers')
  await page.getByRole('button', { name: 'Сатып алушы қосу', exact: true }).click()
  let modal = page.getByRole('dialog')
  const name = `Бастапқы қарыз ${w}`
  await modal.getByRole('textbox', { name: 'Аты', exact: true }).fill(name)
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/customers') && response.request().method() === 'POST',
  )
  await modal.getByRole('button', { name: 'Сақтау', exact: true }).click()
  const customer = (await (await created).json()) as components['schemas']['CustomerOut']
  await page.goto(`/customers/${customer.id}`)
  await expect(page.locator('.mantine-Notification-root')).toHaveCount(0, { timeout: 10000 })
  await expect(page.getByText('Қарызы жоқ', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Қарызды түзету', exact: true }).click()
  modal = page.getByRole('dialog')
  await expect(modal.getByRole('button', { name: 'Сақтау', exact: true })).toBeDisabled()
  await expect(modal.getByText(/^Түзетуден кейінгі қарыз:/)).toHaveCount(0)
  await modal.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }).fill('50000')
  await expect(modal.getByRole('button', { name: 'Бастапқы қалдық', exact: true })).toHaveCount(0)
  await expect(modal.getByRole('button', { name: 'Сақтау', exact: true })).toBeDisabled()
  await modal.getByRole('button', { name: 'Қарызды көбейту', exact: true }).click()
  await modal.getByRole('button', { name: 'Бастапқы қалдық', exact: true }).click()
  await expect(
    modal.getByText(`Түзетуден кейінгі қарыз: ${formatMoney(5000000)}`, { exact: true }),
  ).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Сақтау', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await expect(modal.getByText(/^Қазіргі қарыз:/)).toBeInViewport({ ratio: 1 })
  await expect(modal.getByText(/^Түзетуден кейінгі қарыз:/)).toBeInViewport({ ratio: 1 })
  await snap(page, 'debt-adjustment-increase-modal', w, { fullPage: false })
  await modal.getByRole('button', { name: 'Қосымша', exact: true }).click()
  await modal.getByLabel('Күні мен уақыты', { exact: true }).scrollIntoViewIfNeeded()
  await expect(modal.getByRole('button', { name: 'Сақтау', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await snap(page, 'debt-adjustment-date-modal', w, { fullPage: false })
  await modal.getByRole('button', { name: 'Қосымша', exact: true }).click()
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/debt-adjustments') && response.request().method() === 'POST',
  )
  await modal.getByRole('button', { name: 'Сақтау', exact: true }).click()
  const adjustment = (await (
    await savedResponse
  ).json()) as components['schemas']['DebtAdjustmentOut']
  expect(adjustment).toMatchObject({ amount: 5000000, reason: 'Бастапқы қалдық', status: 'posted' })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('customer-debt')).toHaveText(formatMoney(5000000))
  await page.getByRole('button', { name: 'Төлем қабылдау', exact: true }).click()
  modal = page.getByRole('dialog')
  await modal.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }).fill('20000')
  await modal.getByRole('button', { name: 'Сақтау', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('customer-debt')).toHaveText(formatMoney(3000000))
  expect(
    (await getJson<components['schemas']['CustomerOut']>(page, `/api/customers/${customer.id}`))
      .debt,
  ).toBe(3000000)
  await expect(page.locator('.mantine-Notification-root')).toHaveCount(0, { timeout: 10000 })
  await snap(page, 'customer-adjustment-ledger', w)

  await page.getByRole('button', { name: 'Қарызды түзету', exact: true }).click()
  modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: 'Қарызды азайту', exact: true }).click()
  await modal.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }).fill('10000')
  await modal.getByRole('button', { name: 'Қарыз кешірілді', exact: true }).click()
  await expect(
    modal.getByText(`Түзетуден кейінгі қарыз: ${formatMoney(2000000)}`, { exact: true }),
  ).toBeVisible()
  await snap(page, 'debt-adjustment-decrease-modal', w, { fullPage: false })
  await modal.getByRole('button', { name: 'Қарызды көбейту', exact: true }).click()
  await expect(modal.getByRole('textbox', { name: 'Себебі', exact: true })).toHaveValue('')
  await modal.getByRole('button', { name: 'Қате түзету', exact: true }).click()
  await modal.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }).fill('30000')
  await expect(
    modal.getByText('Соманы тексеріңіз. Артық нөл жазылған жоқ па?', { exact: true }),
  ).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Сақтау', exact: true })).toBeEnabled()
  await expect(modal.getByRole('button', { name: 'Сақтау', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await expect(
    modal.getByText('Соманы тексеріңіз. Артық нөл жазылған жоқ па?', { exact: true }),
  ).toBeInViewport({ ratio: 1 })
  await snap(page, 'debt-adjustment-warning-modal', w, { fullPage: false })
  await modal.getByRole('button', { name: 'Бас тарту', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const ledger = page.getByRole('heading', { name: 'Есеп айырысу', exact: true }).locator('..')
  const adjustmentRow =
    w === '1366'
      ? ledger.getByRole('row').filter({ hasText: `Түзету №${adjustment.number}` })
      : ledger.locator('.mantine-Card-root').filter({ hasText: `Түзету №${adjustment.number}` })
  await adjustmentRow.getByRole('button', { name: 'Күшін жою', exact: true }).click()
  modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: 'Қате енгізілді', exact: true }).click()
  await snap(page, 'debt-adjustment-cancel-modal', w, { fullPage: false })
  await modal.getByRole('button', { name: 'Түзетудің күшін жою', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Артық төлем', { exact: true })).toBeVisible()
  await expect(page.getByTestId('customer-debt')).toHaveText(formatMoney(2000000))
  expect(
    (await getJson<components['schemas']['CustomerOut']>(page, `/api/customers/${customer.id}`))
      .debt,
  ).toBe(-2000000)
  const history = await getJson<components['schemas']['LedgerPage']>(
    page,
    `/api/customers/${customer.id}/ledger`,
  )
  expect(history.items).toHaveLength(1)
  expect(history.items[0]).toMatchObject({ kind: 'payment', debt_after: -2000000 })
  await expect(page.locator('.mantine-Notification-root')).toHaveCount(0, { timeout: 10000 })
  await snap(page, 'customer-adjustment-overpayment', w)
})

test('manual stock adjustment posts once and keeps the existing form behavior', async ({
  page,
}) => {
  await login(page)
  const created = await page.request.post('/api/products', {
    data: { article: `STOCK-22-${width(page)}`, name: 'Қалдықты тексеру', sale_price: 10000 },
  })
  expect(created.status()).toBe(201)
  const product = (await created.json()) as Product
  await page.goto(`/products/${product.id}`)
  await page.getByRole('button', { name: 'Санын түзету', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByRole('textbox', { name: 'Себебі' })).toBeVisible()
  await modal.getByRole('textbox', { name: 'Сатып алу бағасы, ₸' }).fill('500')
  await modal.getByRole('textbox', { name: 'Себебі' }).fill('Пересчёт')
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/stock/adjustments') && response.request().method() === 'POST',
  )
  await modal.getByRole('button', { name: 'Қосу', exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const body = response.request().postDataJSON() as components['schemas']['AdjustmentCreate']
  expect(body.request_id).toMatch(/^[a-f0-9-]{36}$/)
  await expect(modal).toHaveCount(0)
  const replay = await page.request.post('/api/stock/adjustments', { data: body })
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(await response.json())
  const updated = await getJson<Product>(page, `/api/products/${product.id}`)
  expect(updated.stock).toBe(1)
  const history = await getJson<components['schemas']['MovementPage']>(
    page,
    `/api/products/${product.id}/movements`,
  )
  expect(history.total).toBe(1)
})

test('invoice keeps the product name after editing its card', async ({ page }) => {
  await login(page)
  const suffix = `${width(page)}-${crypto.randomUUID().slice(0, 8)}`
  const original = `Бұрынғы атауы ${suffix}`
  const productResponse = await page.request.post('/api/products', {
    data: { article: `SNAP-${suffix}`, name: original, sale_price: 100000 },
  })
  expect(productResponse.status()).toBe(201)
  const product = (await productResponse.json()) as Product
  expect(
    (
      await page.request.post('/api/receipts', {
        data: {
          request_id: crypto.randomUUID(),
          lines: [{ product_id: product.id, qty: 3, unit_cost: 50000 }],
        },
      })
    ).status(),
  ).toBe(201)
  const saleResponse = await page.request.post('/api/sales', {
    data: {
      request_id: crypto.randomUUID(),
      lines: [{ product_id: product.id, qty: 1, unit_price: 80000 }],
    },
  })
  expect(saleResponse.status()).toBe(201)
  const sale = (await saleResponse.json()) as Sale
  await page.goto(`/products/${product.id}`)
  await page.getByRole('button', { name: 'Өзгерту', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Атауы', exact: true }).fill(`Жаңа атауы ${suffix}`)
  await dialog.getByRole('button', { name: 'Сақтау', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.goto(`/sales/${sale.id}/print`)
  await expect(page.locator('.z2-items')).toContainText(original)
  await expect(page.locator('.z2-items')).not.toContainText(`Жаңа атауы ${suffix}`)
})

test('action budget for the five everyday documents', async ({ page }) => {
  const { Actions } = await import('./actions.js')
  await login(page)
  const suffix = `${width(page)}-${crypto.randomUUID().slice(0, 8)}`
  const productResponse = await page.request.post('/api/products', {
    data: { article: `BUDGET-${suffix}`, name: 'Әрекеттерді тексеру', sale_price: 100000 },
  })
  expect(productResponse.ok()).toBeTruthy()
  const product = (await productResponse.json()) as Product
  const customerResponse = await page.request.post('/api/customers', {
    data: { name: `Бюджет ${suffix}` },
  })
  expect(customerResponse.ok()).toBeTruthy()
  const customer = (await customerResponse.json()) as Customer
  const seed = await page.request.post('/api/receipts', {
    data: {
      request_id: crypto.randomUUID(),
      lines: [{ product_id: product.id, qty: 10, unit_cost: 50000 }],
    },
  })
  expect(seed.ok()).toBeTruthy()
  let cashSale: Sale | undefined
  for (const debt of [false, true]) {
    await page.goto('/sell')
    const actions = new Actions()
    await actions.fill(page.getByRole('searchbox', { name: SEARCH }), product.article)
    await actions.enter(page.getByRole('searchbox', { name: SEARCH }))
    await expect(page.getByRole('textbox', { name: `${product.article} саны` })).toBeVisible()
    await actions.click(page.getByRole('button', { name: 'Келесі: сатып алушы' }))
    await expect(page.getByRole('heading', { name: 'Кімге сатамыз?' })).toBeVisible()
    await actions.fill(page.getByRole('searchbox'), customer.name)
    await actions.click(page.locator('.flow-choice').filter({ hasText: customer.name }))
    if (debt) await actions.click(page.getByRole('button', { name: 'Қарызға', exact: true }))
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/sales') && r.request().method() === 'POST',
    )
    await actions.click(page.getByRole('button', { name: 'Сатылымды сақтау' }))
    const saved = (await (await response).json()) as Sale
    await expect(page.getByRole('heading', { name: 'Сатылым сақталды' })).toBeVisible()
    if (!debt) cashSale = saved
    actions.check(debt ? 'debtSale' : 'cashSale')
  }
  await page.goto('/receive')
  const receipt = new Actions()
  await receipt.fill(page.getByRole('searchbox', { name: SEARCH }), product.article)
  await receipt.enter(page.getByRole('searchbox', { name: SEARCH }))
  await receipt.fill(
    page.getByRole('textbox', { name: `${product.article} сатып алу бағасы` }),
    '500',
  )
  await receipt.click(page.getByRole('button', { name: 'Қоймаға қосу' }))
  await expect(page.getByRole('heading', { name: 'Тауар қоймаға қосылды' })).toBeVisible()
  receipt.check('receipt')
  await page.goto(`/customers/${customer.id}`)
  const payment = new Actions()
  await payment.click(page.getByRole('button', { name: 'Төлем қабылдау' }))
  const modal = page.getByRole('dialog')
  await payment.fill(modal.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }), '1000')
  await payment.click(modal.getByRole('button', { name: 'Сақтау', exact: true }))
  await expect(modal).toHaveCount(0)
  payment.check('payment')
  await page.goto(`/sales/${cashSale!.id}`)
  const goodReturn = new Actions()
  await goodReturn.click(page.getByRole('link', { name: 'Қайтару', exact: true }))
  await goodReturn.fill(page.getByRole('textbox', { name: `${product.article} саны` }), '1')
  await goodReturn.click(page.getByRole('button', { name: 'Қайтаруды сақтау' }))
  await expect(page.getByRole('heading', { name: /^Қайтару №/ })).toBeVisible()
  goodReturn.check('goodReturn')
})

async function draftCase(page: Page, tag: string, count = 1) {
  const suffix = `${width(page)}-${crypto.randomUUID().slice(0, 8)}`
  const products: Product[] = []
  for (let i = 0; i < count; i++) {
    const response = await page.request.post('/api/products', {
      data: {
        article: `${tag}-${suffix}-${i}`,
        name: 'Байланысты тексеру',
        sale_price: 100000,
      },
    })
    expect(response.ok()).toBeTruthy()
    products.push((await response.json()) as Product)
  }
  const receipt = await page.request.post('/api/receipts', {
    data: {
      request_id: crypto.randomUUID(),
      lines: products.map((p) => ({ product_id: p.id, qty: 1, unit_cost: 50000 })),
    },
  })
  expect(receipt.ok()).toBeTruthy()
  const response = await page.request.post('/api/customers', { data: { name: `${tag} ${suffix}` } })
  expect(response.ok()).toBeTruthy()
  const customer = (await response.json()) as Customer
  await page.goto('/sell')
  for (const product of products) await addByEnter(page, product.article)
  return { products, customer }
}

async function reviewCase(page: Page, customer: Customer) {
  await page.getByRole('button', { name: 'Келесі: сатып алушы' }).click()
  await expect(page.getByRole('heading', { name: 'Кімге сатамыз?' })).toBeVisible()
  await page.getByRole('searchbox').fill(customer.name)
  await page.locator('.flow-choice').filter({ hasText: customer.name }).click()
  await expect(page.getByRole('heading', { name: 'Тексеріңіз' })).toBeVisible()
}

for (const accepted of [true, false]) {
  test(`draft safety: ${accepted ? 'server accepted, response lost' : 'abort before server and reload'}`, async ({
    page,
  }) => {
    await login(page)
    const { customer } = await draftCase(page, accepted ? 'LOST' : 'BEFORE')
    await reviewCase(page, customer)
    const bodies: components['schemas']['SaleCreate'][] = []
    let savedId: number | undefined
    await page.route('**/api/sales', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      bodies.push(route.request().postDataJSON() as components['schemas']['SaleCreate'])
      if (bodies.length === 1) {
        if (accepted) {
          const response = await route.fetch()
          expect(response.status()).toBe(201)
          savedId = ((await response.json()) as Sale).id
        }
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Сатылымды сақтау' }).click()
    await expect(page.getByTestId('unknown-result')).toBeVisible()
    if (!accepted) {
      await page.reload()
      await expect(page.getByTestId('unknown-result')).toBeVisible()
    }
    await page.getByRole('button', { name: 'Қайта тексеру' }).click()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1]).toEqual(bodies[0])
    await expect(page.getByRole('heading', { name: 'Сатылым сақталды' })).toBeVisible()
    const sales = await getJson<components['schemas']['SalePage']>(
      page,
      `/api/sales?customer_id=${customer.id}`,
    )
    expect(sales.total).toBe(1)
    if (accepted) expect(sales.items[0].id).toBe(savedId)
  })
}

test('draft safety: two visible lines without network and recovery', async ({ page }) => {
  await login(page)
  const { products } = await draftCase(page, 'LINES', 2)
  const me = await getJson<components['schemas']['UserOut']>(page, '/api/auth/me')
  const key = `qoima.draft.${me.id}.sale`
  const before = await page.evaluate((key) => localStorage.getItem(key), key)
  const productUrl = /\/api\/products\/\d+$/
  await page.route(productUrl, (route) => route.abort('failed'))
  await page.reload()
  await expect(page.getByTestId('line-load-error')).toBeVisible()
  await expect(page.getByTestId('flow-line')).toHaveCount(2)
  for (const product of products)
    await expect(page.getByText(product.article, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Келесі: сатып алушы' })).toBeDisabled()
  const stored = await page.evaluate((key) => localStorage.getItem(key), key)
  expect(JSON.parse(stored!).lines).toEqual(JSON.parse(before!).lines)
  await page.unroute(productUrl)
  await page.getByRole('button', { name: 'Қайталау', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Келесі: сатып алушы' })).toBeEnabled()
  await expect(page.getByTestId('flow-line')).toHaveCount(2)
})

test('draft safety: expired product session preserves the draft through login', async ({
  page,
}) => {
  await login(page)
  const { products } = await draftCase(page, 'SESSION', 2)
  const me = await getJson<components['schemas']['UserOut']>(page, '/api/auth/me')
  const key = `qoima.draft.${me.id}.sale`
  const before = await page.evaluate((key) => localStorage.getItem(key), key)
  const logout = await page.request.post('/api/auth/logout')
  expect(logout.ok()).toBeTruthy()
  let firstMe = true
  // Let the product request encounter the expired session, instead of the initial auth guard.
  await page.route('**/api/auth/me', async (route) => {
    if (firstMe) {
      firstMe = false
      await route.fulfill({ json: me })
    } else await route.continue()
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Кіру', exact: true })).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before)
  await page.getByLabel('Логин').fill('demo')
  await page.getByLabel('Құпиясөз').fill(process.env.DEMO_PASSWORD!)
  await page.getByRole('button', { name: 'Кіру', exact: true }).click()
  await page.waitForURL('**/sell')
  await expect(page.getByTestId('flow-line')).toHaveCount(2)
  for (const product of products)
    await expect(page.getByRole('textbox', { name: `${product.article} саны` })).toBeVisible()
  expect(
    JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!).requestId,
  ).toBe(JSON.parse(before!).requestId)
})

test('write-off: adjustment uses current time after demo and appears in report details', async ({
  page,
}) => {
  await login(page)
  const article = `WRITE-OFF-27-${width(page)}`
  const created = await page.request.post('/api/products', {
    data: { article, name: 'Есептен шығаруды тексеру', sale_price: 300000 },
  })
  expect(created.status()).toBe(201)
  const product = (await created.json()) as components['schemas']['ProductOut']
  const receipt = await page.request.post('/api/receipts', {
    data: {
      request_id: crypto.randomUUID(),
      lines: [{ product_id: product.id, qty: 10, unit_price_minor: 201250 }],
    },
  })
  expect(receipt.status()).toBe(201)
  const today = todayLocal()
  await page.goto(`/report?from=${today}&to=${today}`)
  await settle(page)
  await page.goto(`/products/${product.id}`)
  await page.getByRole('button', { name: 'Санын түзету', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByText('Азайту', { exact: true }).click()
  await modal.getByRole('textbox', { name: 'Саны', exact: true }).fill('3')
  await modal.getByRole('button', { name: 'Тауар шатасты', exact: true }).click()
  const before = Date.now()
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/stock/adjustments') && response.request().method() === 'POST',
  )
  await modal.getByRole('button', { name: 'Азайту', exact: true }).click()
  const response = await posted
  expect(response.status()).toBe(201)
  const adjustment = (await response.json()) as components['schemas']['AdjustmentOut']
  const after = Date.now()
  const timestamp = new Date(adjustment.movement.created_at).getTime()
  expect(timestamp).toBeGreaterThanOrEqual(before - 1000)
  expect(timestamp).toBeLessThanOrEqual(after + 1000)
  expect(adjustment.movement).toMatchObject({ qty: -3, note: 'Тауар шатасты' })
  await expect(modal).toHaveCount(0)
  await page.getByRole('link', { name: 'Басты бет', exact: true }).click()
  await page.getByRole('link', { name: 'Тағы', exact: true }).click()
  await page.getByRole('link', { name: 'Есеп', exact: true }).click()
  await expect(page.getByText(/Есептен шығарылды:/)).toBeVisible()
  const section = page.getByTestId('report-adjustments-minus')
  await section.getByRole('button', { name: 'Көрсету', exact: true }).click()
  const row =
    width(page) === '1366'
      ? section.getByRole('row').filter({ hasText: article })
      : section.locator('[data-row-key]').filter({ hasText: article }).filter({ visible: true })
  await expect(row).toContainText('Тауар шатасты')
  await expect(row).toContainText('6\u00a0037,50\u00a0₸')
  const pageData = await getJson<components['schemas']['AdjustmentReportPage']>(
    page,
    `/api/reports/adjustments?from=${today}&to=${today}&direction=minus`,
  )
  expect(pageData.items.find((item) => item.movement_id === adjustment.movement.id)).toMatchObject({
    value: 603750,
    qty: -3,
  })
  await row.getByRole('link', { name: article, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/products/${product.id}$`))
})
