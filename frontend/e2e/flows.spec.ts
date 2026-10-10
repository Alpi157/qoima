import { expect, type Page, test } from '@playwright/test'

import { getJson, login, settle, snap } from './snap.js'
import { formatMoney } from '../src/lib/money.js'

// The sale and receiving flows of docs/design/simple-ui.md step by step, on demo data.
// They save a sale and a receiving, so they run after the screens (playwright.config.ts).

const SEARCH = 'Артикулды немесе атауын жазыңыз'

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
  // Two in stock: three of them show the orange warning and block «Келесі».
  await addByEnter(page, '22401-8H515')
  await page.getByRole('textbox', { name: '22401-8H515 саны' }).fill('3')
  await expect(page.getByText('Қоймада тек 2 дана бар. Санын азайтыңыз.')).toBeVisible()
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

  await page.getByRole('button', { name: 'Қосымша' }).click()
  await page.getByRole('textbox', { name: 'Жеткізуші' }).fill('«Автоимпорт» ЖШС')
  await page.getByRole('textbox', { name: 'IKH16TT сатып алу бағасы' }).fill('1100')
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
