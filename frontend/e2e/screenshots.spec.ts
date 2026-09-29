import { expect, type Page, test } from '@playwright/test'

// Every screen of docs/design/design-system.md, «Проверка глазами», in Kazakh on demo data.
// Files: review/screenshots/<screen>-<width>.png. Each screen is also checked for machine
// dates, horizontal scrolling and the number of h1.

const OUT_DIR = '../review/screenshots'
const MACHINE_DATE = /\b\d{4}-\d{2}-\d{2}\b/

interface ListPage<T> {
  items: T[]
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  // Loaders are replaced by content once the queries are done.
  await expect(page.locator('.mantine-Loader-root')).toHaveCount(0)
}

interface SnapOptions {
  /** The invoice has no h1: it is a printed form. */
  h1?: boolean
  /** Dialogs: only the visible screen, the backdrop does not cover a full-page capture. */
  fullPage?: boolean
}

async function snap(page: Page, name: string, width: string, options: SnapOptions = {}) {
  await settle(page)
  const text = await page.locator('body').innerText()
  expect.soft(text, `${name}: date in machine format`).not.toMatch(MACHINE_DATE)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect.soft(overflow, `${name}: horizontal scroll`).toBeLessThanOrEqual(0)
  if (options.h1 !== false) {
    expect.soft(await page.locator('h1').count(), `${name}: one h1`).toBe(1)
  }
  await page.screenshot({
    path: `${OUT_DIR}/${name}-${width}.png`,
    fullPage: options.fullPage !== false,
    animations: 'disabled',
  })
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url)
  expect(response.ok(), url).toBeTruthy()
  return (await response.json()) as T
}

test('screens', async ({ page }, testInfo) => {
  const width = testInfo.project.name
  const password = process.env.DEMO_PASSWORD
  if (!password) throw new Error('DEMO_PASSWORD is not set: run make screenshots')

  await page.goto('/login')
  await snap(page, 'login', width)
  await page.getByLabel('Логин').fill('demo')
  await page.getByLabel('Құпиясөз').fill(password)
  await page.getByRole('button', { name: 'Кіру' }).click()
  await page.waitForURL('/')

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
    ['sell', '/sell'],
    ['receive', '/receive'],
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
  await expect(page.getByRole('dialog')).toBeVisible()
  await snap(page, 'sale-cancel-modal', width, { fullPage: false })

  await page.goto(`/sales/${saleId}/print`)
  await snap(page, 'invoice', width, { h1: false })
})
