import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

import { getJson, type ListPage, login, settle, snap } from './snap.js'

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
  const receipts = await getJson<ListPage<{ id: number }>>(page, '/api/receipts')
  const sales = await getJson<ListPage<{ id: number; status: string }>>(page, '/api/sales')
  const productId = products.items[0].id
  const customerId = customers.items[0].id
  const receiptId = receipts.items[0].id
  const saleId = sales.items.find((sale) => sale.status === 'posted')!.id

  const screens: [string, string][] = [
    ['home', '/'],
    ['more', '/more'],
    ['stock', '/stock'],
    ['products', '/products'],
    ['product', `/products/${productId}`],
    ['customers', '/customers'],
    ['customer', `/customers/${customerId}`],
    ['receipts', '/receipts'],
    ['receipt', `/receipts/${receiptId}`],
    ['sales', '/sales'],
    ['sale', `/sales/${saleId}`],
    ['settings', '/settings'],
    ['not-found', '/no-such-page'],
  ]
  for (const [name, path] of screens) {
    await page.goto(path)
    await snap(page, name, width)
  }

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
