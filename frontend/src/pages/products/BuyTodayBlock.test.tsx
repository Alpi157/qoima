import { screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { makeBuyToday, makeProduct, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { setupUser } from '../../test/user'
import { type BuyToday } from './api'
import { BuyTodayBlock } from './BuyTodayBlock'

afterEach(() => vi.restoreAllMocks())

function renderBlock(changes: Partial<BuyToday> = {}) {
  vi.spyOn(api, 'GET').mockReturnValue(ok(makeBuyToday(changes)))
  return renderWithProviders(<BuyTodayBlock product={makeProduct()} />)
}

it.each(['ru', 'kk', 'zh'])(
  'shows purchase basis, rate and integer markup in %s',
  async (language) => {
    await i18n.changeLanguage(language)
    renderBlock()
    const block = await screen.findByTestId('buy-today-block')
    const link = await within(block).findByRole('link')
    expect(link.getAttribute('href')).toBe('/receipts/5')
    expect(block.textContent).toContain('80%')
    expect(block.textContent).toContain('51%')
    expect(block.textContent?.replace(/\s/g, ' ')).toContain('17 325')
  },
)

it.each([
  [
    { buy_today: null, reason_unavailable: 'no_purchase', basis: null },
    'Нет закупки, чтобы посчитать цену сегодня.',
  ],
  [
    { buy_today: null, reason_unavailable: 'no_rate' },
    'Нет курса Нацбанка, цену сегодня посчитать нельзя.',
  ],
  [{ difference_vs_avg: -105000, buy_today: 700000 }, 'дешевле'],
  [{ difference_vs_avg: 157500 }, 'дороже'],
  [
    {
      basis: 'quote',
      expenses_known: false,
      cost_then: null,
      markup_then: null,
      price_to_keep_markup: null,
    },
    'Расходы на закупку неизвестны, не учтены',
  ],
] as [Partial<BuyToday>, string][])('renders state %j', async (changes, text) => {
  renderBlock(changes)
  expect(await screen.findByText(new RegExp(text))).toBeTruthy()
})

it('labels a previous rate with its date', async () => {
  renderBlock({
    rates: [{ currency: 'CNY', rate: '60.0000', rate_date: '2026-10-18', exact: false }],
  })
  expect(await screen.findByText(/18.10.2026.*взят|взят.*18.10.2026/)).toBeTruthy()
})

it.each([
  ['purchase', 'Расчёт вернётся к последней закупке.'],
  ['quote', 'Расчёт вернётся к предыдущей цене поставщика.'],
  [null, 'Посчитать цену сегодня будет не из чего.'],
] as const)('chooses cancellation confirmation for %s', async (basis, text) => {
  const user = setupUser()
  renderBlock({
    active_quote: {
      id: 3,
      currency: 'CNY',
      price_minor: 12000,
      quoted_on: '2026-10-20',
      cancel_fallback_basis: basis,
    },
  })
  const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ status: 'cancelled' }))
  await user.click(await screen.findByRole('button', { name: 'Удалить эту цену' }))
  const modal = screen.getByRole('dialog')
  expect(within(modal).getByText(new RegExp(text))).toBeTruthy()
  await user.click(within(modal).getByRole('button', { name: 'Удалить эту цену' }))
  expect(post).toHaveBeenCalledWith('/api/price-quotes/{quote_id}/cancel', {
    params: { path: { quote_id: 3 } },
  })
})
