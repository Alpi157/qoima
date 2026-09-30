import { expect, type Page, test } from '@playwright/test'

import { login, settle, snap } from './snap.js'

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
