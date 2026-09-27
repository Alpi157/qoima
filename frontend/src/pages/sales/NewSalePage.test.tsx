import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { formatMoney } from '../../lib/money'
import { fieldErrorOf } from '../../test/fields'
import { makeProduct, makeSale, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { SALE_REQUEST_CONFLICT, type SaleCreate } from './api'
import { NewSalePage } from './NewSalePage'

const FILTER = makeProduct({
  id: 1,
  article: 'OC-90',
  name: 'Фильтр масляный',
  stock: 4,
  sale_price: 1250000,
})
const PADS = makeProduct({ id: 2, article: 'BP-1', name: 'Колодки', stock: 10, sale_price: 800050 })

function renderPage() {
  return renderWithDataRouter(
    [
      { path: '/sale', element: <NewSalePage /> },
      { path: '/sales', element: <p>История продаж</p> },
      { path: '/sales/:id', element: <p>Карточка продажи</p> },
    ],
    { route: '/sale' },
  )
}

/** The product search answers with whatever product has the typed article. */
function mockSearch() {
  return vi.spyOn(api, 'GET').mockImplementation(((_path: string, init: never) => {
    const q = String((init as { params: { query: { q: string } } }).params.query.q).toLowerCase()
    const items = [FILTER, PADS].filter((p) => p.article.toLowerCase().startsWith(q))
    return ok({ items, total: items.length })
  }) as never)
}

function search(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Добавить товар' })
}

async function pick(user: UserEvent, article: string) {
  await user.type(search(), article)
  await screen.findByRole('option', { name: new RegExp(article) })
  await user.keyboard('{Enter}')
}

function qtyInput(article: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `Количество ${article}` }) as HTMLInputElement
}

function priceInput(article: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `Цена ${article}` }) as HTMLInputElement
}

function postButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Провести продажу' }) as HTMLButtonElement
}

function sentBodies(post: { mock: { calls: unknown[][] } }): SaleCreate[] {
  return post.mock.calls.map((call) => (call[1] as { body: SaleCreate }).body)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NewSalePage', () => {
  it('fills the price from the product and always sends unit_price', async () => {
    const user = userEvent.setup()
    mockSearch()
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeSale({ id: 9, number: 21 })))
    const { router } = renderPage()

    expect(postButton().disabled).toBe(true)
    await pick(user, 'OC-90')
    expect(qtyInput('OC-90').value).toBe('1')
    expect(document.activeElement).toBe(qtyInput('OC-90'))
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(search())

    await pick(user, 'BP-1')
    expect(priceInput('OC-90').value).toBe('12500')
    expect(priceInput('BP-1').value).toBe('8000,50')
    await user.clear(priceInput('BP-1'))
    await user.type(priceInput('BP-1'), '7000')
    expect(screen.getByTestId('sale-total').textContent).toBe(formatMoney(1950000))
    await user.click(postButton())

    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/9'))
    const [body] = sentBodies(post)
    expect(post.mock.calls[0][0]).toBe('/api/sales')
    expect(body.lines).toStrictEqual([
      { product_id: 1, qty: 1, unit_price: 1250000 },
      { product_id: 2, qty: 1, unit_price: 700000 },
    ])
    expect(body.customer_id).toBeNull()
    // The date was not touched: the server takes the moment of posting.
    expect('sold_at' in body).toBe(false)
  })

  it('picking the same product again increases its quantity', async () => {
    const user = userEvent.setup()
    mockSearch()
    renderPage()

    await pick(user, 'OC-90')
    await pick(user, 'OC-90')

    expect(screen.getAllByRole('textbox', { name: /^Количество / })).toHaveLength(1)
    expect(qtyInput('OC-90').value).toBe('2')
    expect(screen.getByTestId('sale-total').textContent).toBe(formatMoney(2500000))
  })

  it('a quantity above the stock shows the stock and blocks posting', async () => {
    const user = userEvent.setup()
    mockSearch()
    renderPage()

    await pick(user, 'OC-90')
    expect(postButton().disabled).toBe(false)
    await user.clear(qtyInput('OC-90'))
    await user.type(qtyInput('OC-90'), '5')

    expect(screen.getByText('На остатке 4')).toBeTruthy()
    expect(postButton().disabled).toBe(true)

    await user.clear(qtyInput('OC-90'))
    await user.type(qtyInput('OC-90'), '4')
    expect(screen.queryByText('На остатке 4')).toBeNull()
    expect(postButton().disabled).toBe(false)
  })

  it('keeps request_id when retrying after an error and takes a new one after a sale', async () => {
    const user = userEvent.setup()
    mockSearch()
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(new ApiError(500, 'Внутренняя ошибка'))
      .mockReturnValue(ok(makeSale({ id: 9 })))
    const { router } = renderPage()

    await pick(user, 'OC-90')
    await user.click(postButton())
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(postButton().disabled).toBe(false))
    await user.click(postButton())
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/9'))

    await act(() => router.navigate('/sale'))
    await pick(user, 'OC-90')
    await user.click(postButton())
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3))

    const [first, retry, next] = sentBodies(post).map((body) => body.request_id)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(retry).toBe(first)
    expect(next).not.toBe(first)
  })

  it('shows a stock shortage from the server as it is', async () => {
    const user = userEvent.setup()
    mockSearch()
    const message = 'Недостаточно товара OC-90: на остатке 1, нужно 2'
    vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(409, message))
    renderPage()

    await pick(user, 'OC-90')
    await user.click(postButton())

    expect((await screen.findByRole('alert')).textContent).toBe(message)
  })

  it('explains a request_id conflict and links to the sales history', async () => {
    const user = userEvent.setup()
    mockSearch()
    vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(409, SALE_REQUEST_CONFLICT))
    renderPage()

    await pick(user, 'OC-90')
    await user.click(postButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Продажа могла уже пройти. Проверьте историю продаж')
    expect(within(alert).getByRole('link', { name: 'историю продаж' }).getAttribute('href')).toBe(
      '/sales',
    )
  })

  it('shows line errors from the server under the right field', async () => {
    const user = userEvent.setup()
    mockSearch()
    vi.spyOn(api, 'POST').mockRejectedValue(
      new ApiError(422, 'Проверьте введённые данные', {
        'lines.1.unit_price': 'Должно быть не больше 100000000',
      }),
    )
    renderPage()

    await pick(user, 'OC-90')
    await pick(user, 'BP-1')
    await user.click(postButton())

    await waitFor(() =>
      expect(fieldErrorOf(priceInput('BP-1'))).toBe('Должно быть не больше 100000000'),
    )
    expect(fieldErrorOf(priceInput('OC-90'))).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Ctrl+Enter posts the sale from the quantity field', async () => {
    const user = userEvent.setup()
    mockSearch()
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeSale({ id: 9 })))
    const { router } = renderPage()

    await pick(user, 'OC-90')
    expect(document.activeElement).toBe(qtyInput('OC-90'))
    await user.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/9'))
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('asks before leaving with lines that are not posted', async () => {
    const user = userEvent.setup()
    mockSearch()
    const { router } = renderPage()

    await pick(user, 'OC-90')
    await act(() => router.navigate('/sales'))

    const dialog = await screen.findByRole('dialog', { name: 'Уйти без проведения?' })
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(router.state.location.pathname).toBe('/sale')
  })
})
