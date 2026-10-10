import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { draftKey } from '../../components/flow'
import { makeCustomer, makeProduct, makeSale, ok } from '../../test/fixtures'
import { mockFlowGet, postBody } from '../../test/flowApi'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { SaleCreate } from '../sales/api'
import type { SaleDraft } from './saleDraft'
import { SellDonePage } from './SellDonePage'
import { SellPage } from './SellPage'

const FILTER = makeProduct({ id: 1, article: 'OC-90', name: 'Фильтр масляный', stock: 5 })
const PLUG = makeProduct({
  id: 2,
  article: 'IKH16TT',
  name: 'Свеча зажигания',
  sale_price: 150000,
  stock: 1,
})
const PRODUCTS = [FILTER, PLUG]
const ERZHAN = makeCustomer({ id: 7, name: 'Ержан', phone: '77011234567' })
const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const SALE_KEY = draftKey(1, 'sale')

function renderSell(route = '/sell') {
  return renderWithDataRouter(
    [
      { path: '/sell', element: <SellPage /> },
      { path: '/sell/done/:id', element: <SellDonePage /> },
      { path: '/', element: <h1>Главная</h1> },
    ],
    { route },
  )
}

function saveDraft(draft: Partial<SaleDraft>, key = SALE_KEY) {
  const full: SaleDraft = {
    version: 1,
    requestId: REQUEST_ID,
    lines: [{ productId: 1, qty: 2, price: null }],
    customer: null,
    payment: { mode: 'full', paid: '', method: 'cash' },
    ...draft,
  }
  localStorage.setItem(key, JSON.stringify(full))
}

function storedDraft(key = SALE_KEY): SaleDraft | null {
  const text = localStorage.getItem(key)
  return text === null ? null : (JSON.parse(text) as SaleDraft)
}

function qtyField(article: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `Количество ${article}` }) as HTMLInputElement
}

function nextButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Далее: покупатель' }) as HTMLButtonElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SellPage, step 1', () => {
  it('Enter adds the first found product, adding it again raises the quantity', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    renderSell()

    const search = await screen.findByRole('searchbox', { name: 'Напишите артикул или название' })
    expect(document.activeElement).toBe(search)
    await fill(user, search, 'oc')
    await user.keyboard('{Enter}')

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    expect(qtyField('OC-90').value).toBe('1')
    expect((search as HTMLInputElement).value).toBe('')

    await fill(user, search, 'OC-9')
    await user.click(await screen.findByRole('button', { name: 'Добавить OC-90' }))
    expect(qtyField('OC-90').value).toBe('2')
    expect(screen.getAllByTestId('flow-line')).toHaveLength(1)
    expect(storedDraft()?.lines).toEqual([{ productId: 1, qty: 2, price: null }])
  })

  it('offers frequent products while the search is empty and says when nothing is found', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS, frequent: [PLUG] })
    renderSell()

    expect(await screen.findByText('Часто продаются:')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Добавить IKH16TT' }))
    expect(qtyField('IKH16TT').value).toBe('1')

    await fill(user, screen.getByRole('searchbox'), 'XYZ')
    expect(
      await screen.findByText('«XYZ» не найден. Проверьте артикул и напишите ещё раз.'),
    ).toBeTruthy()
  })

  it('a quantity above the stock blocks «Далее» and says why', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    saveDraft({ lines: [{ productId: 2, qty: 1, price: null }] })
    renderSell()

    await screen.findByRole('textbox', { name: 'Количество IKH16TT' })
    const stock = screen.getByTestId('line-stock-2')
    expect(stock.textContent).toBe('На складе: 1 шт')
    expect(stock.classList.contains('flow-hint-warning')).toBe(false)
    expect(nextButton().disabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Увеличить' }))
    expect(qtyField('IKH16TT').value).toBe('2')
    expect(stock.classList.contains('flow-hint-warning')).toBe(true)
    expect(screen.getByText('На складе только 1 шт. Уменьшите количество.')).toBeTruthy()
    expect(nextButton().disabled).toBe(true)
    expect(screen.getByText('Исправьте товары, отмеченные оранжевым.')).toBeTruthy()
  })

  it('without lines «Далее» is blocked with a hint', async () => {
    mockFlowGet({ products: PRODUCTS })
    renderSell()

    await screen.findByText('Товары в продаже')
    expect(nextButton().disabled).toBe(true)
    expect(screen.getByText('Сначала добавьте товар.')).toBeTruthy()
  })
})

describe('SellPage, steps in the address', () => {
  it('«Далее» adds ?step=2 and the browser Back returns to step 1', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS, recent: [ERZHAN] })
    saveDraft({})
    const { router } = renderSell()

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(nextButton())
    expect(await screen.findByRole('heading', { name: 'Кому продаём?' })).toBeTruthy()
    expect(router.state.location.search).toBe('?step=2')

    await router.navigate(-1)
    expect(await screen.findByRole('heading', { name: 'Что продаём?' })).toBeTruthy()
    expect(router.state.location.search).toBe('')
  })

  it('?step=3 without lines leads to step 1', async () => {
    mockFlowGet({ products: PRODUCTS })
    const { router } = renderSell('/sell?step=3')

    expect(await screen.findByRole('heading', { name: 'Что продаём?' })).toBeTruthy()
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('?step=3 with lines but no customer leads to step 2', async () => {
    mockFlowGet({ products: PRODUCTS })
    saveDraft({})
    const { router } = renderSell('/sell?step=3')

    expect(await screen.findByRole('heading', { name: 'Кому продаём?' })).toBeTruthy()
    await waitFor(() => expect(router.state.location.search).toBe('?step=2'))
  })
})

describe('SellPage, step 2', () => {
  it('shows positive debt both in recent customers and search results', async () => {
    const user = setupUser()
    const customer = { ...ERZHAN, debt: 100050 }
    mockFlowGet({ products: PRODUCTS, recent: [customer], customers: [customer] })
    saveDraft({})
    renderSell('/sell?step=2')
    expect(await screen.findByText('Долг: 1 000,50 ₸')).toBeTruthy()
    await fill(user, screen.getByRole('searchbox'), 'Ержан')
    await screen.findByText('Результаты поиска')
    await screen.findByRole('button', { name: /Ержан.*Долг:/ })
    expect(screen.getByText('Долг: 1 000,50 ₸')).toBeTruthy()
  })
  it('shows the latest customers; picking one goes to step 3', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS, recent: [ERZHAN] })
    saveDraft({})
    const { router } = renderSell('/sell?step=2')

    expect(await screen.findByText('Последние покупатели')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: /Ержан/ }))

    expect(await screen.findByRole('heading', { name: 'Проверьте' })).toBeTruthy()
    expect(router.state.location.search).toBe('?step=3')
    expect(storedDraft()?.customer).toEqual({ id: 7, name: 'Ержан', phone: '77011234567' })
  })

  it('creates a customer on the spot and goes on with him', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    const created = makeCustomer({ id: 12, name: 'Болат', phone: null })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(created))
    saveDraft({})
    renderSell('/sell?step=2')

    await fill(user, await screen.findByRole('searchbox'), 'Болат')
    expect(
      await screen.findByText('Такой покупатель не найден. Добавьте нового покупателя ниже.'),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Новый покупатель' }))
    expect(
      (screen.getByRole('textbox', { name: 'Имя нового покупателя' }) as HTMLInputElement).value,
    ).toBe('Болат')
    await user.click(screen.getByRole('button', { name: 'Сохранить и выбрать' }))

    expect(post.mock.calls[0][0]).toBe('/api/customers')
    expect(postBody(post)).toEqual({ name: 'Болат', phone: null })
    expect(await screen.findByRole('heading', { name: 'Проверьте' })).toBeTruthy()
    expect(screen.getByText('Болат')).toBeTruthy()
  })

  it('«Продолжить без покупателя» shows a retail customer on step 3', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    saveDraft({})
    renderSell('/sell?step=2')

    await user.click(await screen.findByRole('button', { name: 'Продолжить без покупателя' }))
    expect(await screen.findByText('Розничный покупатель')).toBeTruthy()
  })
})

describe('SellPage, step 3', () => {
  it('disables debt without a customer and offers a link to step 2', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    saveDraft({ customer: 'none' })
    const { router } = renderSell('/sell?step=3')
    const debt = await screen.findByRole('button', { name: 'В долг' })
    expect((debt as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Для продажи в долг выберите покупателя.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Выбрать покупателя' }))
    expect(router.state.location.search).toBe('?step=2')
  })

  it('resets debt mode when switching to a retail customer', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    saveDraft({ customer: ERZHAN, payment: { mode: 'debt', paid: '1000', method: 'cash' } })
    renderSell('/sell?step=2')
    await user.click(await screen.findByRole('button', { name: 'Продолжить без покупателя' }))
    expect(storedDraft()?.payment).toEqual({ mode: 'full', paid: '', method: 'cash' })
  })

  it.each([
    ['1000,50', 100050],
    ['', 0],
  ])('sends debt payment %s as %i tiyn', async (paid, expected) => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeSale()))
    saveDraft({ customer: ERZHAN })
    renderSell('/sell?step=3')
    await user.click(await screen.findByRole('button', { name: 'В долг' }))
    const field = screen.getByRole('textbox', { name: 'Сколько заплатили сейчас, ₸' })
    expect(document.activeElement).toBe(field)
    if (paid) await fill(user, field, paid)
    expect(
      screen.getByText(`Останется в долг: ${expected ? '23 999,50' : '25 000'} ₸`),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(postBody<SaleCreate>(post).paid_amount).toBe(expected)
    expect(postBody<SaleCreate>(post).request_id).toBe(REQUEST_ID)
  })

  it('blocks excessive and malformed payments and keeps the typed amount in the draft', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    const post = vi.spyOn(api, 'POST')
    saveDraft({ customer: ERZHAN })
    renderSell('/sell?step=3')
    await user.click(await screen.findByRole('button', { name: 'В долг' }))
    const field = screen.getByRole('textbox', { name: 'Сколько заплатили сейчас, ₸' })
    await fill(user, field, '25001')
    expect(screen.getByText('Не больше суммы продажи')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Сохранить продажу' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(storedDraft()?.payment).toEqual({ mode: 'debt', paid: '25001', method: 'cash' })
    await fill(user, field, '1,2,3')
    expect(
      (screen.getByRole('button', { name: 'Сохранить продажу' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(post).not.toHaveBeenCalled()
  })
  it('sends the draft request_id and an explicit unit_price in every line', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeSale({ id: 9 })))
    saveDraft({
      lines: [
        { productId: 1, qty: 2, price: null },
        { productId: 2, qty: 1, price: '1400' },
      ],
      customer: { id: 7, name: 'Ержан', phone: null },
    })
    const { router } = renderSell('/sell?step=3')

    await user.click(await screen.findByRole('button', { name: 'Сохранить продажу' }))

    expect(post.mock.calls[0][0]).toBe('/api/sales')
    expect(postBody<SaleCreate>(post)).toEqual({
      request_id: REQUEST_ID,
      customer_id: 7,
      paid_amount: 2640000,
      payment_method: 'cash',
      lines: [
        { product_id: 1, qty: 2, unit_price: 1250000 },
        { product_id: 2, qty: 1, unit_price: 140000 },
      ],
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sell/done/9'))
    expect(storedDraft()).toBeNull()
  })

  it('keeps the request_id after an error and after a reload, and resends with it', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(new ApiError(500, 'Ошибка'))
      .mockReturnValue(ok(makeSale({ id: 9 })))
    saveDraft({ customer: 'none' })
    const first = renderSell('/sell?step=3')

    await user.click(await screen.findByRole('button', { name: 'Сохранить продажу' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(storedDraft()?.requestId).toBe(REQUEST_ID)

    // Reload: the screen opens again from the draft.
    first.unmount()
    renderSell('/sell?step=3')
    expect(await screen.findByText('Незавершённая продажа восстановлена.')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Сохранить продажу' }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(postBody<SaleCreate>(post, 0).request_id).toBe(REQUEST_ID)
    expect(postBody<SaleCreate>(post, 1).request_id).toBe(REQUEST_ID)
    expect(postBody<SaleCreate>(post, 1).customer_id).toBeNull()
  })

  it('a request_id conflict says the sale may have passed and links to the history', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    vi.spyOn(api, 'POST').mockRejectedValue(
      new ApiError(409, 'Конфликт', {}, 'sale_request_conflict'),
    )
    saveDraft({ customer: 'none' })
    renderSell('/sell?step=3')

    await user.click(await screen.findByRole('button', { name: 'Сохранить продажу' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Продажа могла уже пройти')
    expect(within(alert).getByRole('link').getAttribute('href')).toBe('/sales')
  })

  it('a stock shortage from the server is shown above the button', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    vi.spyOn(api, 'POST').mockRejectedValue(
      new ApiError(409, 'Недостаточно', {}, 'insufficient_stock', {
        items: [{ article: 'OC-90', available: 1, requested: 2 }],
      }),
    )
    saveDraft({ customer: 'none' })
    renderSell('/sell?step=3')

    await user.click(await screen.findByRole('button', { name: 'Сохранить продажу' }))
    expect((await screen.findByRole('alert')).textContent).toContain('OC-90')
  })
})

describe('SellPage, draft', () => {
  it('hides the restored notice after editing a line and keeps the draft', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    saveDraft({})
    renderSell()
    expect(await screen.findByText('Незавершённая продажа восстановлена.')).toBeTruthy()
    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(screen.getByRole('button', { name: 'Увеличить' }))
    expect(screen.queryByText('Незавершённая продажа восстановлена.')).toBeNull()
    expect(storedDraft()?.lines[0].qty).toBe(3)
  })

  it('hides the restored notice when the user changes steps', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    saveDraft({})
    const { router } = renderSell()
    expect(await screen.findByText('Незавершённая продажа восстановлена.')).toBeTruthy()
    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(nextButton())
    expect(router.state.location.search).toBe('?step=2')
    expect(screen.queryByText('Незавершённая продажа восстановлена.')).toBeNull()
  })
  it('restores the draft with the current price and clears it with «Очистить»', async () => {
    const user = setupUser()
    mockFlowGet({ products: [{ ...FILTER, sale_price: 1500000 }] })
    saveDraft({})
    renderSell()

    expect(await screen.findByText('Незавершённая продажа восстановлена.')).toBeTruthy()
    const price = await screen.findByRole('textbox', { name: 'Цена OC-90' })
    expect((price as HTMLInputElement).value).toBe('15000')

    await user.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(await screen.findByText(/Товаров пока нет/)).toBeTruthy()
    expect(storedDraft()).toBeNull()
  })

  it('«Отмена» with lines asks first, then deletes the draft', async () => {
    const user = setupUser()
    mockFlowGet({ products: PRODUCTS })
    saveDraft({})
    const { router } = renderSell()

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    const dialog = screen.getByRole('dialog', { name: 'Отменить?' })
    expect(storedDraft()).not.toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Да, отменить' }))
    expect(storedDraft()).toBeNull()
    expect(router.state.location.pathname).toBe('/')
  })

  it('another user does not see this draft', async () => {
    mockFlowGet({ products: PRODUCTS, userId: 2 })
    saveDraft({})
    renderSell()

    expect(await screen.findByText(/Товаров пока нет/)).toBeTruthy()
    expect(screen.queryByText('Незавершённая продажа восстановлена.')).toBeNull()
    expect(storedDraft(draftKey(1, 'sale'))).not.toBeNull()
  })

  it('drops a line whose product is gone', async () => {
    mockFlowGet({ products: PRODUCTS })
    saveDraft({
      lines: [
        { productId: 1, qty: 1, price: null },
        { productId: 99, qty: 1, price: null },
      ],
    })
    renderSell()

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await waitFor(() => expect(storedDraft()?.lines).toHaveLength(1))
  })
})

describe('SellDonePage', () => {
  it('shows the original sale debt and the fresh total customer debt', async () => {
    const get = mockFlowGet({
      customers: [makeCustomer({ debt: 350000 })],
      sale: makeSale({ debt_at_sale: 60000, customer: { id: 7, name: 'Ержан', phone: null } }),
    })
    renderSell('/sell/done/9')
    expect(await screen.findByText('В долг: 600 ₸')).toBeTruthy()
    expect(await screen.findByText('Общий долг покупателя: 3 500 ₸')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/api/customers/{customer_id}', {
      params: { path: { customer_id: 7 } },
    })
  })
  it('shows the saved sale and prints with auto=1', async () => {
    mockFlowGet({
      sale: makeSale({
        id: 9,
        number: 21,
        total: 2500000,
        customer: { id: 7, name: 'Ержан', phone: null },
      }),
    })
    renderSell('/sell/done/9')

    expect(await screen.findByRole('heading', { name: 'Продажа сохранена' })).toBeTruthy()
    expect(screen.getByText('Накладная №21')).toBeTruthy()
    expect(screen.getByText('Ержан')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Напечатать' }).getAttribute('href')).toBe(
      '/sales/9/print?auto=1',
    )
    expect(screen.getByRole('link', { name: 'Новая продажа' }).getAttribute('href')).toBe('/sell')
  })
})

describe('sale payment method', () => {
  it.each(['', '0', '1000'])(
    'shows method only for positive payment and sends the correct method for %s',
    async (paid) => {
      const user = setupUser()
      mockFlowGet({ products: [FILTER], customers: [ERZHAN] })
      saveDraft({ customer: ERZHAN, payment: { mode: 'debt', paid, method: 'card' } })
      const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeSale()))
      renderSell('/sell?step=3')
      await screen.findByRole('heading', { name: 'Проверьте' })
      expect(screen.queryByRole('group', { name: 'Как заплатили?' }) !== null).toBe(paid === '1000')
      await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }))
      expect(postBody<SaleCreate>(post).payment_method).toBe(paid === '1000' ? 'card' : null)
    },
  )

  it('defaults old drafts to cash and retains card after returning to step 3', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER], customers: [ERZHAN] })
    localStorage.setItem(
      SALE_KEY,
      JSON.stringify({
        version: 1,
        requestId: 'old',
        lines: [{ productId: FILTER.id, qty: 1, price: null }],
        customer: ERZHAN,
        payment: { mode: 'full', paid: '' },
      }),
    )
    const rendered = renderSell('/sell?step=3')
    const cash = await screen.findByRole('button', { name: 'Наличные' })
    expect(cash.getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Карта / Kaspi' }))
    expect(storedDraft()?.payment.method).toBe('card')
    rendered.unmount()
    renderSell('/sell?step=3')
    expect(
      (await screen.findByRole('button', { name: 'Карта / Kaspi' })).getAttribute('aria-pressed'),
    ).toBe('true')
  })
})

it('hides payment method for a fully paid zero-total sale and sends null', async () => {
  const user = setupUser()
  mockFlowGet({ products: [makeProduct({ ...FILTER, sale_price: 0 })] })
  saveDraft({ customer: 'none' })
  const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeSale()))
  renderSell('/sell?step=3')
  await screen.findByRole('heading', { name: 'Проверьте' })
  expect(screen.queryByRole('group', { name: 'Как заплатили?' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }))
  expect(postBody<SaleCreate>(post).payment_method).toBeNull()
})
