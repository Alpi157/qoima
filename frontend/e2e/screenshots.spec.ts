import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

import { getJson, type ListPage, login, settle, snap } from './snap.js'
import type { components } from '../src/api/schema.js'
import { todayLocal } from '../src/lib/dates.js'

type Sale = components['schemas']['SaleOut']
type ReturnDocument = components['schemas']['ReturnOut']
type ReturnListItem = components['schemas']['ReturnListItem']

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
        lines: [{ product_id: id, qty: 2, unit_cost: 60000 }],
      },
    })
    expect(receipt.ok()).toBeTruthy()
    const sale = await page.request.post('/api/sales', {
      data: {
        request_id: crypto.randomUUID(),
        payment_method: 'cash',
        lines: [{ product_id: id, qty: 2 }],
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
