import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { makeBusinessSettings, makeSale, ok } from '../../test/fixtures'
import { fakeKazakh } from '../../test/i18n'
import { renderWithDataRouter } from '../../test/render'
import type { BusinessSettings } from '../settings/api'
import type { Sale } from './api'
import { InvoicePrintPage } from './InvoicePrintPage'

const NBSP = ' '

const SALE = makeSale({
  id: 9,
  number: 21,
  sold_at: '2026-09-27T09:00:00Z',
  customer: { id: 7, name: 'Ержан', phone: '+7 701 123 45 67' },
  created_by_name: 'Айгерим',
  lines: [
    {
      product_id: 1,
      article: 'OC-90',
      name: 'Фильтр масляный',
      unit: 'шт',
      qty: 2,
      unit_price: 1250000,
      line_total: 2500000,
    },
    {
      product_id: 2,
      article: 'BP-1',
      name: 'Колодки',
      unit: 'компл',
      qty: 1,
      unit_price: 180050,
      line_total: 180050,
    },
  ],
  total: 2680050,
})

function mockApi(sale: Sale = SALE, settings: BusinessSettings = makeBusinessSettings()) {
  return vi
    .spyOn(api, 'GET')
    .mockImplementation(((path: string) => ok(path === '/api/settings' ? settings : sale)) as never)
}

function renderPage(route = '/sales/9/print') {
  return renderWithDataRouter(
    [
      { path: '/sales/:id/print', element: <InvoicePrintPage /> },
      { path: '/sales/:id', element: <p>Карточка продажи</p> },
      { path: '/settings', element: <p>Настройки</p> },
    ],
    { route },
  )
}

async function invoice(): Promise<HTMLElement> {
  return screen.findByTestId('invoice')
}

let print: ReturnType<typeof vi.fn>

beforeEach(() => {
  print = vi.fn()
  vi.stubGlobal('print', print)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function cellTexts(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '')
}

describe('InvoicePrintPage', () => {
  it('shows the form З-2 header, seller, document number and parties', async () => {
    mockApi()
    renderPage()

    const text = (await invoice()).textContent ?? ''
    expect(text).toContain('Приложение 26')
    expect(text).toContain('к приказу Министра финансов')
    expect(text).toContain('Республики Казахстан')
    expect(text).toContain('20 декабря 2012 г. № 562')
    expect(text).toContain('Форма З-2')
    expect(text).toContain('Организация (индивидуальный предприниматель)3А Аuto Parts.KZ')
    expect(text).toContain('ИИН/БИН900101300123')
    expect(
      screen.getByRole('heading', { name: 'Накладная на отпуск запасов на сторону' }),
    ).toBeTruthy()

    const docTable = screen.getByRole('columnheader', { name: 'Номер документа' }).closest('table')!
    expect(cellTexts(docTable)).toStrictEqual(['21', '27.09.2026'])

    const parties = screen.getByRole('columnheader', { name: /отправитель$/ }).closest('table')!
    expect(
      within(parties)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toStrictEqual([
      'Организация (индивидуальный предприниматель) - отправитель',
      'Организация (индивидуальный предприниматель) - получатель',
      'Ответственный за поставку (Ф.И.О.)',
      'Транспортная организация',
      'Товарно-транспортная накладная (номер, дата)',
    ])
    expect(cellTexts(parties)).toStrictEqual(['3А Аuto Parts.KZ', 'Ержан', 'Кәкеш Арман', '', ''])
    expect(screen.queryByTestId('settings-warning')).toBeNull()
  })

  it('has every column caption and the column numbers 1-9', async () => {
    mockApi()
    renderPage()

    await invoice()
    const items = screen.getByRole('columnheader', { name: 'Номер по порядку' }).closest('table')!
    const headers = within(items)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headers).toStrictEqual([
      'Номер по порядку',
      'Наименование, характеристика',
      'Номенклатурный номер',
      'Единица измерения',
      'Количество',
      'Цена за единицу, в тенге',
      'Сумма с НДС, в тенге',
      'Сумма НДС, в тенге',
      'подлежит отпуску',
      'отпущено',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ])
  })

  it('puts the article in the nomenclature number column and quantities in both', async () => {
    mockApi()
    renderPage()

    await invoice()
    // Three header rows: captions, «Количество» subcolumns, column numbers.
    const items = screen.getByRole('columnheader', { name: 'Номер по порядку' }).closest('table')!
    const [, , , first, second] = within(items).getAllByRole('row')
    expect(cellTexts(first)).toStrictEqual([
      '1',
      'Фильтр масляный',
      'OC-90',
      'шт',
      '2',
      '2',
      `12${NBSP}500`,
      `25${NBSP}000`,
      '0',
    ])
    expect(cellTexts(second)).toStrictEqual([
      '2',
      'Колодки',
      'BP-1',
      'компл',
      '1',
      '1',
      `1${NBSP}800,50`,
      `1${NBSP}800,50`,
      '0',
    ])
  })

  it('shows the total row with «х» and the quantity and amount in words', async () => {
    mockApi()
    renderPage()

    await invoice()
    expect(cellTexts(screen.getByTestId('invoice-total-row'))).toStrictEqual([
      '',
      'Итого',
      '3',
      '3',
      'х',
      `26${NBSP}800,50`,
      '0',
    ])
    expect(screen.getByText('Всего отпущено количество запасов (прописью)')).toBeTruthy()
    expect(screen.getByTestId('qty-in-words').textContent).toBe('три')
    expect(screen.getByText('на сумму (прописью), в тенге')).toBeTruthy()
    expect(screen.getByTestId('amount-in-words').textContent).toBe(
      'двадцать шесть тысяч восемьсот теңге 50 тиын',
    )
  })

  it('shows the signature block with names from the settings', async () => {
    mockApi()
    renderPage()

    const text = (await invoice()).textContent ?? ''
    expect(text).toContain('Отпуск разрешил')
    expect(text).toContain('должность')
    expect(text).toContain('Главный бухгалтер')
    expect(screen.getByTestId('chief-accountant').textContent).toBe('Қамтамасыз етілмейді')
    expect(text).toContain('М.П.')
    expect(text).toContain('Отпустил')
    expect(screen.getByTestId('released-by').textContent).toBe('Кәкеш А.')
    expect(text).toContain('расшифровка подписи')
    expect(text).toContain('По доверенности №_____ от «____»____________20 __ года')
    expect(text).toContain('выданной')
    expect(text).toContain('Запасы получил')
  })

  it('signs «Отпустил» with the user who posted the sale when the setting is empty', async () => {
    mockApi(SALE, makeBusinessSettings({ released_by_name: '' }))
    renderPage()

    await invoice()
    expect(screen.getByTestId('released-by').textContent).toBe('Айгерим')
  })

  it('names a sale without a customer a retail one', async () => {
    mockApi(makeSale({ ...SALE, customer: null }))
    renderPage()

    await invoice()
    const parties = screen.getByRole('columnheader', { name: /получатель$/ }).closest('table')!
    expect(cellTexts(parties)[1]).toBe('Розничный покупатель')
  })

  it('marks a cancelled sale', async () => {
    mockApi(makeSale({ ...SALE, status: 'cancelled' }))
    renderPage()

    await invoice()
    expect(screen.getByText('ОТМЕНЕНА')).toBeTruthy()
  })

  it('does not mark a posted sale', async () => {
    mockApi()
    renderPage()

    await invoice()
    expect(screen.queryByText('ОТМЕНЕНА')).toBeNull()
  })

  it('opens the print dialog once with auto=1 and drops the flag from the address', async () => {
    mockApi()
    const { router } = renderPage('/sales/9/print?auto=1')

    await invoice()
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('does not print by itself without auto=1, but prints on the button', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()

    await invoice()
    expect(print).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Печать' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('asks to fill in the seller details when the name is empty', async () => {
    mockApi(SALE, makeBusinessSettings({ seller_name: '' }))
    renderPage()

    await invoice()
    const warning = screen.getByTestId('settings-warning')
    expect(warning.textContent).toBe('Заполните реквизиты в настройках')
    expect(warning.closest('.no-print')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'настройках' }).getAttribute('href')).toBe('/settings')
  })

  it('Назад without history goes to the sale card', async () => {
    const user = userEvent.setup()
    mockApi()
    const { router } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Назад' }))
    expect(router.state.location.pathname).toBe('/sales/9')
  })

  it('stays Russian whatever the interface language', async () => {
    mockApi(makeSale({ ...SALE, customer: null, status: 'cancelled' }))
    await fakeKazakh({
      invoice: {
        title: 'Жүкқұжат',
        retailCustomer: 'Бөлшек сатып алушы',
        cancelledStamp: 'ЖОЙЫЛДЫ',
      },
      sales: { print: { print: 'Басып шығару' } },
    })
    renderPage()

    const sheet = await invoice()
    expect(
      within(sheet).getByRole('heading', { name: 'Накладная на отпуск запасов на сторону' }),
    ).toBeTruthy()
    expect(within(sheet).getByText('Розничный покупатель')).toBeTruthy()
    expect(within(sheet).getByText('ОТМЕНЕНА')).toBeTruthy()
    expect(within(sheet).getByText('27.09.2026')).toBeTruthy()
    expect(within(sheet).getByText('Итого')).toBeTruthy()
    expect(sheet.getAttribute('lang')).toBe('ru')
    // The toolbar around the invoice is interface: it follows the language.
    expect(screen.getByRole('button', { name: 'Басып шығару' })).toBeTruthy()
  })

  it.each(['kk', 'zh'])('keeps the stored Russian unit in %s', async (language) => {
    mockApi()
    await i18n.changeLanguage(language)
    renderPage()

    const row = (await screen.findByText('Фильтр масляный')).closest('tr')!
    expect(cellTexts(row)).toContain('шт')
    expect(cellTexts(row)).not.toContain(i18n.t('common.units.pcs'))
  })
})
