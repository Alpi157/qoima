import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

import { getJson, type ListPage, login, settle, snap } from './snap.js'
import { breakReportRender, REPORT_MODULE } from './pageModules.js'
import { PAGE_RELOAD_KEY } from '../src/lib/pageReload.js'
import type { components } from '../src/api/schema.js'
import { todayLocal } from '../src/lib/dates.js'
import { fillCurrencyReceipt, verifyCurrencyReview } from './currencyReceipt.js'
import { buyTodayProduct, enterSupplierQuote } from './buyToday.js'

test('buy today screens in Kazakh', async ({ page }, testInfo) => {
  await login(page)
  const width = testInfo.project.name
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  const product = await buyTodayProduct(page, `BUY28-SCREEN-${width}`)
  await page.goto(`/products/${product.id}`)
  await snap(page, 'buy-today-purchase', width)
  const dialog = await enterSupplierQuote(page)
  await snap(page, 'buy-today-quote-window', width, { fullPage: false })
  await dialog.getByRole('button', { name: 'Сақтау', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('buy-today-block')).toContainText('жеткізушінің')
  await snap(page, 'buy-today-quote', width)
  const unknown = await buyTodayProduct(page, `BUY28-UNKNOWN-${width}`, false)
  await page.goto(`/products/${unknown.id}`)
  await snap(page, 'buy-today-no-basis', width)
  await page.goto('/stock')
  await settle(page)
  await page
    .getByTestId('stock-buy-today')
    .getByRole('button', { name: 'Тағы', exact: true })
    .click()
  await snap(page, 'buy-today-stock', width)
})

test('currency receipt screens in Kazakh', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  await page.route('**/api/receipts/defaults*', (route) =>
    route.fulfill({ json: { currency: 'KZT', source: 'default' } }),
  )
  const catalog = await getJson<components['schemas']['ProductPage']>(
    page,
    '/api/products?limit=200',
  )
  const products = ['CNY-DEMO-100', 'CNY-DEMO-25'].map((article) =>
    catalog.items.find((product) => product.article === article)!,
  )
  await fillCurrencyReceipt(page, products)
  await page.getByRole('button', { name: 'Әкелу шығындары', exact: true }).click()
  await snap(page, 'currency-receive-lines', width)
  await snap(page, 'currency-receive-lines-screen', width, { fullPage: false })
  await page.getByRole('textbox', { name: 'Курс, ₸' }).fill('80')
  await snap(page, 'currency-manual-rate', width)
  await page.route('**/api/rates?*', (route) =>
    route.fulfill({
      status: 404,
      json: { code: 'rate_not_found', detail: 'Нет курса', params: {} },
    }),
  )
  await page.getByRole('button', { name: '$ Доллар', exact: true }).click()
  await expect(
    page.getByText('Ұлттық банк курсын алу мүмкін болмады. Курсты қолмен енгізіңіз.'),
  ).toBeVisible()
  await snap(page, 'currency-no-rate', width)
  await page.unroute('**/api/rates?*')
  await page.getByRole('button', { name: '¥ Юань', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Курс, ₸' })).toHaveValue('67.6200')
  await page.getByRole('button', { name: 'Шығын қосу', exact: true }).click()
  await page.getByRole('button', { name: 'Банк комиссиясы', exact: true }).click()
  await snap(page, 'currency-expenses', width)
  await page
    .getByTestId('receipt-expense')
    .last()
    .getByRole('button', { name: 'Алып тастау', exact: true })
    .click()
  const firstExpense = page.getByTestId('receipt-expense').first()
  await firstExpense.getByRole('button', { name: 'Тағы', exact: true }).click()
  await firstExpense.getByRole('combobox', { name: 'Шығындарды бөлу', exact: true }).click()
  await page.getByRole('option', { name: 'Қолмен', exact: true }).click()
  await expect(firstExpense.getByTestId('expense-allocation-total')).toContainText(
    '105\u00a0000\u00a0₸ / 105\u00a0000\u00a0₸',
  )
  await snap(page, 'currency-allocation', width)
  await page.getByRole('button', { name: 'Келесі', exact: true }).click()
  await verifyCurrencyReview(page)
  await snap(page, 'currency-review', width)
  await snap(page, 'currency-review-screen', width, { fullPage: false })
  await page.getByRole('button', { name: 'Артқа', exact: true }).click()
  await page.getByRole('textbox', { name: 'Курс, ₸' }).fill('80')
  await page.getByRole('button', { name: 'Келесі', exact: true }).click()
  await expect(page.getByTestId('receipt-warnings')).toBeVisible()
  await snap(page, 'currency-warnings', width)
  await page.getByTestId('receipt-warnings').scrollIntoViewIfNeeded()
  await snap(page, 'currency-warnings-screen', width, { fullPage: false, preserveScroll: true })
  const me = await getJson<components['schemas']['UserOut']>(page, '/api/auth/me')
  await page.evaluate((id) => localStorage.removeItem(`qoima.draft.${id}.receipt`), me.id)
  await page.goto('/receive')
  await page.getByRole('searchbox').fill(products[0].article)
  await page.getByRole('searchbox').press('Enter')
  await page
    .getByRole('textbox', { name: `${products[0].article} сатып алу бағасы`, exact: true })
    .fill('20000')
  await page.getByRole('button', { name: 'Қоймаға қосу', exact: true }).click()
  await expect(page.getByTestId('receipt-warnings')).toBeVisible()
  await snap(page, 'currency-kzt-warnings', width)
  await page.getByTestId('receipt-warnings').scrollIntoViewIfNeeded()
  await snap(page, 'currency-kzt-warnings-screen', width, { fullPage: false, preserveScroll: true })
  const receipts = await getJson<components['schemas']['ReceiptPage']>(
    page,
    '/api/receipts?limit=200',
  )
  const receipt = receipts.items.find((document) => document.supplier === 'CNY Demo')!
  await page.goto(`/receipts/${receipt.id}`)
  await snap(page, 'currency-receipt-card', width)
  await page.goto(`/products/${products[0].id}`)
  await page
    .getByRole('heading', { name: 'Сатып алу тарихы', exact: true })
    .scrollIntoViewIfNeeded()
  await snap(page, 'currency-purchases', width)
  await page
    .getByRole('heading', { name: 'Сатып алу тарихы', exact: true })
    .scrollIntoViewIfNeeded()
  await snap(page, 'currency-purchases-screen', width, { fullPage: false, preserveScroll: true })
  await page.goto('/settings')
  await snap(page, 'currency-settings', width)
  await page
    .getByRole('checkbox', { name: 'Біз ҚҚС төлейміз', exact: true })
    .scrollIntoViewIfNeeded()
  await snap(page, 'currency-settings-screen', width, { fullPage: false, preserveScroll: true })
})

type Sale = components['schemas']['SaleOut']
type ReturnDocument = components['schemas']['ReturnOut']
type ReturnListItem = components['schemas']['ReturnListItem']

test('rate preparation: non-piece archive unit and historical empty requisites', async ({
  page,
}, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  const products = await getJson<components['schemas']['ProductPage']>(
    page,
    '/api/products?limit=200',
  )
  const product = products.items.find((item) => item.stock > 0 && !item.is_archived)!
  await page.route(`**/api/products/${product.id}`, async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), unit: 'л' } })
  })
  await page.goto(`/products/${product.id}`)
  await page.getByRole('button', { name: 'Жасыру', exact: true }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByText(`Қоймада ${product.stock} л қалды. Олар қойма құнында қала береді.`),
  ).toBeVisible()
  await snap(page, 'rates-archive-unit', width, { fullPage: false })
  await page.unroute(`**/api/products/${product.id}`)
  const sales = await getJson<ListPage<Sale>>(page, '/api/sales?limit=200')
  const saleId = sales.items
    .filter((sale) => sale.status === 'posted')
    .sort((left, right) => left.number - right.number)[0].id
  await page.route(`**/api/sales/${saleId}`, async (route) => {
    const response = await route.fetch()
    const sale = (await response.json()) as Sale
    const requisites = Object.fromEntries(Object.keys(sale.requisites).map((key) => [key, '']))
    await route.fulfill({ response, json: { ...sale, requisites } })
  })
  await page.goto(`/sales/${saleId}/print`)
  const warning = page.getByTestId('settings-warning')
  await expect(warning).toContainText('Келесі сатылымдар үшін')
  // The design system's black is #16202A.
  await expect(warning.locator('.mantine-Alert-message')).toHaveCSS('color', 'rgb(22, 32, 42)')
  await expect(warning.getByRole('link')).toHaveAttribute('href', '/settings')
  await snap(page, 'rates-invoice-requisites', width, { fullPage: false, h1: false })
})

test('document snapshots and stock cost screens in Kazakh', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  const products = await getJson<components['schemas']['ProductPage']>(
    page,
    '/api/products?limit=200',
  )
  const product = products.items.find((item) => item.stock > 0 && item.sale_price > 0)!
  await page.goto('/sell')
  await page.getByRole('searchbox').fill(product.article)
  await page.getByRole('searchbox').press('Enter')
  await page
    .getByRole('textbox', { name: `${product.article} бағасы` })
    .fill(String(Math.floor(product.sale_price / 200)))
  await expect(page.getByText(/Жеңілдік:.*%/)).toBeVisible()
  await page.getByText(/Жеңілдік:.*%/).scrollIntoViewIfNeeded()
  await snap(page, 'snapshot-sale-discount', width, { fullPage: false, preserveScroll: true })
  await page.getByRole('button', { name: 'Келесі: сатып алушы' }).click()
  await page.getByRole('button', { name: 'Сатып алушысыз жалғастыру' }).click()
  await expect(page.getByText(/Жеңілдік:/)).toBeVisible()
  await snap(page, 'snapshot-review-discount', width, { fullPage: false })
  // Clear this demonstration draft without posting it or changing seeded stock.
  await page.evaluate(() => localStorage.clear())
  await page.goto('/stock')
  await expect(page.getByText(/Архивте қалдығы бар:/)).toBeVisible()
  await snap(page, 'snapshot-archived-stock', width, { fullPage: false })
  await page.goto(`/products/${product.id}`)
  await page.getByRole('button', { name: 'Жасыру', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(/Олар қойма құнында қала береді/)).toBeVisible()
  await snap(page, 'snapshot-archive-warning', width, { fullPage: false })
  await page.getByRole('dialog').getByRole('button', { name: 'Бас тарту', exact: true }).click()
  const created = await page.request.post('/api/products', {
    data: {
      article: `COST-SCREEN-${width}`,
      name: 'Сатып алу бағасы белгісіз тауар',
      sale_price: 100000,
    },
  })
  expect(created.status()).toBe(201)
  const unknown = (await created.json()) as components['schemas']['ProductOut']
  await page.goto(`/products/${unknown.id}`)
  await page.getByRole('button', { name: 'Санын түзету', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Сатып алу бағасы, ₸' })).toBeVisible()
  await snap(page, 'snapshot-adjustment-cost', width, { fullPage: false })
})

test('route error screens', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  const viewport = page.viewportSize()!
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  for (const moduleError of [true, false]) {
    await page.goto('/more')
    await settle(page)
    if (moduleError) {
      await page.evaluate((key) => sessionStorage.setItem(key, String(Date.now())), PAGE_RELOAD_KEY)
      await page.route(REPORT_MODULE, (route) =>
        route.fulfill({ status: 404, body: 'Missing module' }),
      )
    } else await breakReportRender(page)
    await page.getByRole('link', { name: 'Есеп', exact: true }).click()
    await expect(
      page.getByRole('heading', {
        name: moduleError ? 'Бағдарлама жаңартылды' : 'Бірдеңе дұрыс болмады',
      }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Жаңарту', exact: true })).toBeInViewport()
    await snap(page, `route-error-${moduleError ? 'module' : 'general'}`, width, {
      fullPage: false,
    })
    await page.unroute(REPORT_MODULE)
  }
  await page.setViewportSize(viewport)
})

test('additional search results and debt adjustment directions', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  const products = await getJson<components['schemas']['ProductPage']>(
    page,
    '/api/products?limit=6',
  )
  expect(products.items).toHaveLength(6)
  await page.route('**/api/products?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'SCREEN-MORE') {
      await route.fulfill({ json: { items: products.items, total: 9 } })
    } else await route.continue()
  })
  for (const path of ['/sell', '/receive']) {
    await page.goto(path)
    await page.getByRole('searchbox').fill('SCREEN-MORE')
    await expect(page.getByText('Тағы 3 тауар табылды. Іздеуді нақтылаңыз.')).toBeVisible()
    await snap(page, `${path.slice(1)}-more-results`, width)
  }
  await page.unroute('**/api/products?*')
  const debts = await getJson<components['schemas']['CustomerDebtsPage']>(
    page,
    '/api/customers/debts',
  )
  const customer = debts.items.find((row) => row.debt > 0)!
  await page.goto(`/customers/${customer.id}`)
  await page.getByRole('button', { name: 'Қарызды түзету', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByRole('button', { name: 'Қате түзету', exact: true })).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Бастапқы қалдық', exact: true })).toHaveCount(0)
  await expect(modal.getByRole('button', { name: 'Қарыз кешірілді', exact: true })).toHaveCount(0)
  await snap(page, 'debt-adjustment-no-direction', width, { fullPage: false })
  for (const [direction, reason, name] of [
    ['Қарызды көбейту', 'Бастапқы қалдық', 'increase'],
    ['Қарызды азайту', 'Қарыз кешірілді', 'decrease'],
  ]) {
    await modal.getByRole('button', { name: direction, exact: true }).click()
    await expect(modal.getByRole('button', { name: reason, exact: true })).toBeVisible()
    await snap(page, `debt-adjustment-${name}-reasons`, width, { fullPage: false })
  }
})

// Every screen of docs/design/design-system.md, «Проверка глазами», in Kazakh on demo data.
// Files: review/screenshots/<screen>-<width>.png. Each screen is also checked for machine
// dates, horizontal scrolling and the number of h1. The sale and receiving flows are in
// flows.spec.ts: they save documents and run after these screens on both widths.

test('screens', async ({ page }, testInfo) => {
  const width = testInfo.project.name

  await page.goto('/login')
  await snap(page, 'login', width)
  await login(page)

  const products = await getJson<ListPage<{ id: number; article: string }>>(
    page,
    '/api/products?q=IKH16TT',
  )
  const customers = await getJson<ListPage<{ id: number }>>(page, '/api/customers')
  const returns = await getJson<ListPage<ReturnListItem>>(page, '/api/returns')
  const receipts = await getJson<ListPage<{ id: number }>>(page, '/api/receipts')
  const sales = await getJson<ListPage<{ id: number; status: string }>>(page, '/api/sales')
  const debts = await getJson<ListPage<{ id: number; debt: number }>>(page, '/api/customers/debts')
  const debtCustomerId = debts.items.find((customer) => customer.debt > 0)!.id
  const debtSales = await getJson<ListPage<{ id: number; debt_at_sale: number; status: string }>>(
    page,
    `/api/sales?customer_id=${debtCustomerId}`,
  )
  const debtSaleId = debtSales.items.find(
    (sale) => sale.status === 'posted' && sale.debt_at_sale > 0,
  )!.id
  const productId = products.items[0].id
  const customerId = customers.items[0].id
  const receiptId = receipts.items[0].id
  const saleDetails = await Promise.all(
    sales.items
      .filter((sale) => sale.status === 'posted')
      .map((sale) => getJson<Sale>(page, `/api/sales/${sale.id}`)),
  )
  const saleId = saleDetails.find(
    (sale) => !sale.returns.some((document) => document.status === 'posted'),
  )!.id
  const withReturn = saleDetails.find(
    (sale) =>
      sale.returns.some((document) => document.status === 'posted') && (sale.outstanding ?? 0) > 0,
  )!
  const formSale = saleDetails.find(
    (sale) =>
      sale.customer &&
      (sale.outstanding ?? 0) > 0 &&
      sale.lines.some((line) => line.qty > line.returned_qty),
  )!
  let retailSale = saleDetails.find(
    (sale) => !sale.customer && sale.lines.some((line) => line.qty > line.returned_qty),
  )
  const postedReturn = returns.items.find(
    (document) => document.status === 'posted' && document.customer,
  )!
  const returnDetails = await Promise.all(
    returns.items
      .filter((document) => document.status === 'posted')
      .map((document) => getJson<ReturnDocument>(page, `/api/returns/${document.id}`)),
  )
  const defective = returnDetails.find((document) =>
    document.lines.some((line) => line.condition === 'defective' && (line.unit_cost ?? 0) > 0),
  )!
  const returnDay = todayLocal(new Date(defective.returned_at))

  const screens: [string, string][] = [
    ['home', '/'],
    ['home-debts', '/'],
    ['home-stock', '/'],
    ['more', '/more'],
    ['stock', '/stock'],
    ['stock-low', '/stock?state=low'],
    ['report-month', '/report'],
    ['report-empty', '/report?from=2099-01-01&to=2099-01-31'],
    ['products', '/products'],
    ['product', `/products/${productId}`],
    ['customers', '/customers'],
    ['customer', `/customers/${customerId}`],
    ['debts', '/debts'],
    ['customer-debt-ledger', `/customers/${debtCustomerId}`],
    ['receipts', '/receipts'],
    ['receipt', `/receipts/${receiptId}`],
    ['sales', '/sales'],
    ['sales-open', '/sales?payment_status=open'],
    ['returns', '/returns'],
    ['return-card', `/returns/${postedReturn.id}`],
    ['sale-return', `/sales/${withReturn.id}`],
    ['customer-return-ledger', `/customers/${postedReturn.customer!.id}`],
    ['report-returns', `/report?from=${returnDay}&to=${returnDay}`],
    ['sale', `/sales/${saleId}`],
    ['sale-debt', `/sales/${debtSaleId}`],
    ['settings', '/settings'],
    ['not-found', '/no-such-page'],
  ]
  for (const [name, path] of screens) {
    await page.goto(path)
    if (name === 'sale-return') {
      await settle(page)
      const caption = page.getByText('Бұл сатылымда қайтару бар. Алдымен қайтарудың күшін жойыңыз.')
      const history = page.getByRole('heading', { name: 'Қайтарулар', exact: true }).locator('..')
      await expect(
        history.getByText('Бұл сатылымда қайтару бар. Алдымен қайтарудың күшін жойыңыз.'),
      ).toBeVisible()
      expect(
        await caption.evaluate((element) => element === element.parentElement!.lastElementChild),
      ).toBe(true)
    }
    await snap(page, name, width)
  }

  // The seeded retail sale is fully returned. Create an isolated example after list shots.
  if (!retailSale) {
    const product = await page.request.post('/api/products', {
      data: {
        article: `RET-SCREEN-${width}`,
        name: 'Қайтару үлгісі',
        sale_price: 120000,
      },
    })
    expect(product.ok()).toBeTruthy()
    const { id } = (await product.json()) as components['schemas']['ProductOut']
    const receipt = await page.request.post('/api/receipts', {
      data: {
        request_id: crypto.randomUUID(),
        lines: [{ product_id: id, qty: 2, unit_cost: 60000 }],
      },
    })
    expect(receipt.ok()).toBeTruthy()
    const sale = await page.request.post('/api/sales', {
      data: {
        request_id: crypto.randomUUID(),
        payment_method: 'cash',
        lines: [{ product_id: id, qty: 2, unit_price: 120000 }],
      },
    })
    expect(sale.ok()).toBeTruthy()
    retailSale = (await sale.json()) as Sale
  }

  for (const [name, document] of [
    ['return-debt', formSale],
    ['return-retail', retailSale],
  ] as const) {
    await page.goto(`/sales/${document.id}/return`)
    await settle(page)
    for (const line of document.lines.filter((line) => line.qty > line.returned_qty).slice(0, 2)) {
      await page.getByRole('textbox', { name: `${line.article} саны` }).fill('1')
    }
    await snap(page, name, width)
    await snap(page, `${name}-screen`, width, { fullPage: false })
  }

  await page.goto(`/customers/${debtCustomerId}`)
  await settle(page)
  await page.getByRole('button', { name: 'Төлем қабылдау' }).click()
  await page.getByRole('button', { name: /Барлық қарыз:/ }).click()
  await snap(page, 'payment-modal', width, { fullPage: false })

  await page.goto('/products')
  await settle(page)
  await page.getByRole('button', { name: 'Тауар қосу' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await snap(page, 'product-new-modal', width, { fullPage: false })

  await page.goto(`/sales/${saleId}`)
  await settle(page)
  await page.getByRole('button', { name: 'Сатылымның күшін жою' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Сатып алушы бас тартты' }).click()
  await snap(page, 'sale-cancel-modal', width, { fullPage: false })

  await page.goto(`/sales/${saleId}/print`)
  await snap(page, 'invoice', width, { h1: false })
})

test('printed invoices fit one A4 page', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  const sales = await getJson<ListPage<{ id: number; status: string }>>(page, '/api/sales')
  for (const lineCount of [3, 12]) {
    let saleId: number | undefined
    let saleLines: { article: string; name: string }[] = []
    for (const candidate of sales.items) {
      if (candidate.status !== 'posted') continue
      const sale = await getJson<{ lines: { article: string; name: string }[] }>(
        page,
        `/api/sales/${candidate.id}`,
      )
      if (sale.lines.length === lineCount) {
        saleId = candidate.id
        saleLines = sale.lines
        break
      }
    }
    expect(saleId, `seeded sale with ${lineCount} lines`).toBeDefined()
    if (lineCount === 12) {
      expect(saleLines.some((line) => line.article === '12686362 41-157')).toBe(true)
      expect(saleLines.some((line) => line.name === 'Колодки тормозные передние')).toBe(true)
    }
    await page.goto(`/sales/${saleId}/print`)
    await settle(page)
    await page.emulateMedia({ media: 'print' })
    const originalViewport = page.viewportSize()!
    // A4 after its 12 mm margins: 186 mm printable width and 273 mm height at 96 px/in.
    await page.setViewportSize({ width: 703, height: 1032 })
    const overflowingCells = await page
      .locator('[data-testid="invoice"] th, [data-testid="invoice"] td')
      .evaluateAll((cells) =>
        cells
          .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
          .map((cell) => ({
            text: cell.textContent?.trim(),
            scrollWidth: cell.scrollWidth,
            clientWidth: cell.clientWidth,
          })),
      )
    expect(overflowingCells, `${lineCount} line invoice: overflowing cells`).toEqual([])
    if (lineCount === 12) {
      await expect(page.locator('.z2-article', { hasText: '12686362 41-157' })).toHaveCSS(
        'white-space',
        'nowrap',
      )
    }
    await page.screenshot({
      path: `../review/screenshots/invoice-${lineCount}-print-${width}.png`,
      fullPage: true,
    })
    if (width === '1366') {
      const path = `../review/screenshots/invoice-${lineCount}.pdf`
      const bytes = await page.pdf({
        path,
        format: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
      })
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount(), `${lineCount} line invoice pages`).toBe(1)
      const { width: pageWidth, height: pageHeight } = pdf.getPage(0).getSize()
      expect(Math.abs(pageWidth - 595.28)).toBeLessThan(1)
      expect(Math.abs(pageHeight - 841.89)).toBeLessThan(1)
    }
    await page.emulateMedia({ media: 'screen' })
    await page.setViewportSize(originalViewport)
  }
})

test('draft safety screens in Kazakh', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  const me = await getJson<components['schemas']['UserOut']>(page, '/api/auth/me')
  const catalog = await getJson<components['schemas']['ProductPage']>(
    page,
    '/api/products?limit=50',
  )
  const products = catalog.items.filter((product) => product.stock > 0).slice(0, 2)
  const key = `qoima.draft.${me.id}.sale`
  const seed = async (unknown: boolean, two = false) =>
    page.evaluate(
      ({ key, products, unknown, two }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            requestId: crypto.randomUUID(),
            unknown,
            lines: products.slice(0, two ? 2 : 1).map((product) => ({
              productId: product.id,
              article: product.article,
              name: product.name,
              qty: 1,
              price: null,
            })),
            customer: 'none',
            payment: { mode: 'full', paid: '', method: 'cash' },
          }),
        )
      },
      { key, products, unknown, two },
    )
  await seed(true)
  await page.goto('/sell?step=3')
  await expect(page.getByTestId('unknown-result')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Қайта тексеру' })).toBeInViewport()
  expect(
    await page
      .getByTestId('review-total')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await snap(page, 'draft-sale-unknown', width)
  await page.getByTestId('unknown-result').scrollIntoViewIfNeeded()
  await snap(page, 'draft-sale-unknown-screen', width, { fullPage: false, preserveScroll: true })

  const debts = await getJson<components['schemas']['CustomerDebtsPage']>(
    page,
    '/api/customers/debts',
  )
  const customer = debts.items.find((row) => row.debt > 1000)!
  await page.goto(`/customers/${customer.id}`)
  await page.getByRole('button', { name: 'Төлем қабылдау', exact: true }).click()
  await page.route('**/api/payments', (route) => route.abort('failed'))
  const modal = page.getByRole('dialog')
  await modal.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }).fill('10')
  await modal.getByRole('button', { name: 'Сақтау', exact: true }).click()
  await expect(modal.getByTestId('unknown-result')).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Қайта тексеру' })).toBeInViewport()
  await snap(page, 'draft-payment-unknown', width, { fullPage: false, preserveScroll: true })
  await page.unroute('**/api/payments')

  await seed(false, true)
  const productUrl = /\/api\/products\/\d+$/
  await page.route(productUrl, (route) => route.abort('failed'))
  await page.goto('/sell')
  await expect(page.getByTestId('line-load-error')).toBeVisible()
  await expect(page.getByTestId('flow-line')).toHaveCount(2)
  await snap(page, 'draft-lines-offline', width)
  await snap(page, 'draft-lines-offline-screen', width, { fullPage: false })
  await page.unroute(productUrl)

  await seed(false)
  const sales = await getJson<components['schemas']['SalePage']>(page, '/api/sales?limit=1')
  const saved = sales.items[0]
  await page.route('**/api/sales', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 409,
        json: {
          detail: 'Этот запрос уже использован для другой продажи',
          code: 'sale_request_conflict',
          params: { id: saved.id, number: saved.number },
        },
      })
    else await route.continue()
  })
  await page.goto('/sell?step=3')
  await page.getByRole('button', { name: 'Сатылымды сақтау' }).click()
  await expect(page.getByTestId('request-conflict')).toContainText(`№${saved.number}`)
  await page.getByTestId('request-conflict').scrollIntoViewIfNeeded()
  await snap(page, 'draft-conflict', width)
  await page.getByTestId('request-conflict').scrollIntoViewIfNeeded()
  await expect(
    page.getByTestId('request-conflict').getByRole('button', { name: 'Ашу' }),
  ).toBeInViewport()
  await snap(page, 'draft-conflict-screen', width, { fullPage: false, preserveScroll: true })
  await page.unroute('**/api/sales')

  await seed(false, true)
  await page.route(productUrl, async (route) => {
    const id = Number(route.request().url().split('/').at(-1))
    if (id === products[0].id)
      await route.fulfill({
        status: 404,
        json: { detail: 'Товар не найден', code: 'product_not_found', params: {} },
      })
    else await route.fulfill({ json: { ...products[1], is_archived: true } })
  })
  await page.goto('/sell')
  await expect(page.getByTestId('removed-products')).toContainText(products[0].article)
  await expect(page.getByTestId('removed-products')).toContainText(products[1].article)
  await snap(page, 'draft-removed-products', width)
  await snap(page, 'draft-removed-products-screen', width, { fullPage: false })
})

test('write-off screens in Kazakh', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  await login(page)
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  const today = todayLocal()
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 11)
  const from = start.toISOString().slice(0, 10)
  const adjustments = await getJson<components['schemas']['AdjustmentReportPage']>(
    page,
    `/api/reports/adjustments?from=${from}&to=${today}&direction=minus`,
  )
  const historical = adjustments.items.find((row) => row.reason === 'Тауар шатасты')!
  expect(historical).toBeTruthy()
  await page.goto(`/products/${historical.product_id}`)
  await page.getByRole('button', { name: 'Санын түзету', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByText('Азайту', { exact: true }).click()
  await modal.getByRole('button', { name: 'Тауар шатасты', exact: true }).click()
  await snap(page, 'write-off-adjustment', width, { fullPage: false })
  await modal.getByRole('button', { name: 'Бас тарту', exact: true }).click()
  await page.goto(`/report?from=${from}&to=${today}`)
  await expect(page.getByText(/Жеңілдіктер:/)).toBeVisible()
  await expect(page.getByText(/Есептен шығарылды:/)).toBeVisible()
  await snap(page, 'write-off-summary', width)
  await page
    .getByTestId('report-adjustments-minus')
    .getByRole('button', { name: 'Көрсету', exact: true })
    .click()
  await expect(
    page
      .getByTestId('report-adjustments-minus')
      .getByText(/Тауар шатасты/)
      .filter({ visible: true }),
  ).toBeVisible()
  await snap(page, 'write-off-details', width)
  const day = todayLocal(new Date(historical.created_at))
  await page.goto(`/report?from=${day}&to=${day}`)
  const summary = await getJson<components['schemas']['SummaryOut']>(
    page,
    `/api/reports/summary?from=${day}&to=${day}`,
  )
  expect(summary.sales_count).toBe(0)
  expect(summary.write_off_count).toBe(1)
  await expect(page.getByText(/Есептен шығарылды:/)).toBeVisible()
  await snap(page, 'write-off-no-sales', width)
})

test('expense screens and profit calculation in Kazakh', async ({ page }, testInfo) => {
  await login(page)
  const width = testInfo.project.name
  if (width === '1366') await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/expenses')
  await expect(
    page.getByText('Күші жойылды', { exact: true }).filter({ visible: true }),
  ).toBeVisible()
  await snap(page, 'expense-list', width)
  await page.getByRole('button', { name: 'Шығыс қосу', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Салықтар мен жарналар', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Сомасы, ₸', exact: true }).fill('30000')
  await expect(dialog).toContainText('екі рет есептеледі')
  await snap(page, 'expense-add-tax', width, { fullPage: false })
  await dialog.getByRole('button', { name: 'Бас тарту', exact: true }).click()
  await page
    .getByRole('button', { name: 'Өткен айдағы жалдау мен жалақыны қайталау', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toContainText('Мына шығыстар жазылады')
  await expect(page.getByRole('dialog').getByText('Осы айда жазылған').first()).toBeVisible()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('checkbox', { name: /Жалдау ақысы/ })
      .first(),
  ).not.toBeChecked()
  await snap(page, 'expense-repeat', width, { fullPage: false })
  await page.getByRole('dialog').getByRole('button', { name: 'Бас тарту', exact: true }).click()
  await page.goto('/expenses?from=2026-02-01&to=2026-02-28')
  await expect(page.getByText('Бұл кезеңде шығыс жазылмаған.')).toBeVisible()
  await snap(page, 'expense-empty', width)

  const product = await buyTodayProduct(page, `EXPENSE29-${width}`)
  const postedSale = await page.request.post('/api/sales', {
    data: {
      request_id: crypto.randomUUID(),
      lines: [{ product_id: product.id, qty: 2, unit_price: 1450000 }],
    },
  })
  expect(postedSale.status()).toBe(201)
  const quote = await page.request.post(`/api/products/${product.id}/price-quotes`, {
    data: {
      request_id: crypto.randomUUID(),
      currency: 'CNY',
      price_minor: 12000,
      quoted_on: todayLocal(),
    },
  })
  expect(quote.status()).toBe(201)
  const adjustment = await page.request.post('/api/stock/adjustments', {
    data: {
      request_id: crypto.randomUUID(),
      product_id: product.id,
      qty: 1,
      reason: 'Тауар шатасты',
    },
  })
  expect(adjustment.status()).toBe(201)
  await page.goto(`/report?from=${todayLocal()}&to=${todayLocal()}`)
  await expect(page.getByTestId('profit-steps')).toContainText('Шығыстардан кейінгі пайда')
  await expect(page.getByTestId('profit-steps')).toContainText('қымбатқа түседі')
  await snap(page, 'expense-profit', width)
  const day = new Date(`${todayLocal()}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() - 10)
  const noSales = day.toISOString().slice(0, 10)
  await page.goto(`/report?from=${noSales}&to=${noSales}`)
  await expect(page.getByTestId('profit-after-expenses')).toContainText('-')
  await snap(page, 'expense-no-sales', width)
  await page.goto('/settings')
  await page.getByRole('heading', { name: 'Пайданы есептеу', exact: true }).scrollIntoViewIfNeeded()
  await snap(page, 'expense-settings', width)
  await page.goto(`/products/${product.id}`)
  await page.getByRole('button', { name: 'Санын түзету', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Сатып алған тауарды')
  await snap(page, 'expense-adjust-plus', width, { fullPage: false })
})
