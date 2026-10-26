import { expect, type Page } from '@playwright/test'
import type { components } from '../src/api/schema.js'
import { todayLocal } from '../src/lib/dates.js'

export type BuyToday = components['schemas']['BuyTodayOut']

/** Per-scenario products keep parallel screenshots and document flows independent. */
export async function buyTodayProduct(page: Page, prefix: string, purchase = true) {
  const created = await page.request.post('/api/products', {
    data: {
      article: `${prefix}-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Бүгін сатып алу: жеткізушінің бағасын тексеру',
      unit: 'шт',
      sale_price: 1450000,
    },
  })
  expect(created.status()).toBe(201)
  const product = (await created.json()) as components['schemas']['ProductOut']
  if (purchase) {
    const received = await page.request.post('/api/receipts', {
      data: {
        request_id: crypto.randomUUID(),
        currency: 'CNY',
        exchange_rate: '67.6200',
        rate_source: 'nbk',
        rate_date: todayLocal(),
        lines: [{ product_id: product.id, qty: 100, unit_price_minor: 10000 }],
        expenses: [
          { kind: 'delivery', amount_minor: 7000000 },
          { kind: 'customs_duty', amount_minor: 3500000 },
        ],
      },
    })
    expect(received.status(), await received.text()).toBe(201)
  }
  return product
}

export async function enterSupplierQuote(page: Page) {
  await page.getByRole('button', { name: 'Жеткізуші жаңа баға айтты', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: '¥ Юань', exact: true }).click()
  await modal.getByRole('textbox', { name: 'Бағасы, ¥', exact: true }).fill('120')
  return modal
}
