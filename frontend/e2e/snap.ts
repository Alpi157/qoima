import { expect, type Page } from '@playwright/test'

// Shared by the screenshot specs (docs/design/design-system.md, «Проверка глазами»).

const OUT_DIR = '../review/screenshots'
const MACHINE_DATE = /\b\d{4}-\d{2}-\d{2}\b/

export interface ListPage<T> {
  items: T[]
}

export async function settle(page: Page) {
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

export async function snap(page: Page, name: string, width: string, options: SnapOptions = {}) {
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
  const fullPage = options.fullPage !== false
  // A full-page capture keeps the scroll position of sticky parts (the header, the totals
  // panel of a flow): scroll to the top and let the panel stand after the lines.
  await page.evaluate(() => window.scrollTo(0, 0))
  const unstick = fullPage
    ? await page.addStyleTag({ content: '.flow-aside { position: static !important; }' })
    : null
  await page.screenshot({
    path: `${OUT_DIR}/${name}-${width}.png`,
    fullPage,
    animations: 'disabled',
  })
  await unstick?.evaluate((style) => (style as Element).remove())
}

export async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url)
  expect(response.ok(), url).toBeTruthy()
  return (await response.json()) as T
}

/** Logs in as the demo user; the password comes from `make screenshots`. */
export async function login(page: Page) {
  const password = process.env.DEMO_PASSWORD
  if (!password) throw new Error('DEMO_PASSWORD is not set: run make screenshots')
  if (!page.url().endsWith('/login')) await page.goto('/login')
  await page.getByLabel('Логин').fill('demo')
  await page.getByLabel('Құпиясөз').fill(password)
  await page.getByRole('button', { name: 'Кіру' }).click()
  await page.waitForURL('/')
}
