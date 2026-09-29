import { expect, test } from '@playwright/test'

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
