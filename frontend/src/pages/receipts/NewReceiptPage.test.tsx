import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { fieldErrorOf } from '../../test/fields'
import { makeProduct, makeReceipt, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { NewReceiptPage } from './NewReceiptPage'

const FILTER = makeProduct({ id: 1, article: 'OC-90', name: 'Фильтр масляный', stock: 4 })
const PADS = makeProduct({ id: 2, article: 'BP-1', name: 'Колодки' })

function renderPage() {
  return renderWithDataRouter(
    [
      { path: '/receipts', element: <p>Список приходов</p> },
      { path: '/receipts/new', element: <NewReceiptPage /> },
      { path: '/receipts/:id', element: <p>Карточка прихода</p> },
    ],
    { route: '/receipts/new' },
  )
}

/** The search answers with whatever product has the typed article. */
function mockSearch() {
  return vi.spyOn(api, 'GET').mockImplementation(((_path: string, init: never) => {
    const q = String((init as { params: { query: { q: string } } }).params.query.q).toLowerCase()
    const items = [FILTER, PADS].filter((p) => p.article.toLowerCase().startsWith(q))
    return ok({ items, total: items.length })
  }) as never)
}

async function pick(user: UserEvent, article: string) {
  await user.type(screen.getByRole('searchbox', { name: 'Добавить товар' }), article)
  await screen.findByRole('option', { name: new RegExp(article) })
  await user.keyboard('{Enter}')
}

function qtyInput(article: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `Количество ${article}` }) as HTMLInputElement
}

function postButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Провести приход' }) as HTMLButtonElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NewReceiptPage', () => {
  it('adds a line with quantity 1 and focuses the quantity; Enter goes back to search', async () => {
    const user = userEvent.setup()
    mockSearch()
    renderPage()

    expect(postButton().disabled).toBe(true)
    await pick(user, 'OC-90')

    expect(qtyInput('OC-90').value).toBe('1')
    expect(document.activeElement).toBe(qtyInput('OC-90'))
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Добавить товар' }))
  })

  it('picking the same product again increases its quantity instead of adding a row', async () => {
    const user = userEvent.setup()
    mockSearch()
    renderPage()

    await pick(user, 'OC-90')
    await pick(user, 'OC-90')

    expect(screen.getAllByRole('textbox', { name: /^Количество / })).toHaveLength(1)
    expect(qtyInput('OC-90').value).toBe('2')
    expect(screen.getByText('Штук: 2')).toBeTruthy()
  })

  it('a line with quantity 0 blocks posting', async () => {
    const user = userEvent.setup()
    mockSearch()
    renderPage()

    await pick(user, 'OC-90')
    expect(postButton().disabled).toBe(false)
    await user.clear(qtyInput('OC-90'))
    await user.type(qtyInput('OC-90'), '0')

    expect(postButton().disabled).toBe(true)
  })

  it('sends lines without an empty unit_cost and opens the posted receipt', async () => {
    const user = userEvent.setup()
    mockSearch()
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReceipt()))
    const { router } = renderPage()

    await user.click(screen.getByRole('button', { name: 'Начальные остатки' }))
    await pick(user, 'OC-90')
    await user.type(screen.getByRole('textbox', { name: 'Закупочная цена OC-90' }), '1 500')
    await pick(user, 'BP-1')
    await user.clear(qtyInput('BP-1'))
    await user.type(qtyInput('BP-1'), '3')
    expect(screen.getByText('Сумма закупки: 1 500 ₸')).toBeTruthy()
    await user.click(postButton())

    await waitFor(() => expect(router.state.location.pathname).toBe('/receipts/5'))
    expect(post).toHaveBeenCalledTimes(1)
    const [path, init] = post.mock.calls[0] as unknown as [string, { body: unknown }]
    expect(path).toBe('/api/receipts')
    // toEqual would ignore an `unit_cost: undefined`; compare the JSON that goes to the server.
    expect(JSON.parse(JSON.stringify(init.body))).toStrictEqual({
      supplier: 'Начальные остатки',
      note: null,
      received_at: null,
      lines: [
        { product_id: 1, qty: 1, unit_cost: 150000 },
        { product_id: 2, qty: 3 },
      ],
    })
    expect(Object.keys((init.body as { lines: object[] }).lines[1])).not.toContain('unit_cost')
  })

  it('shows line errors from the server under the right field', async () => {
    const user = userEvent.setup()
    mockSearch()
    vi.spyOn(api, 'POST').mockRejectedValue(
      new ApiError(422, 'Проверьте введённые данные', {
        'lines.1.qty': 'Должно быть не больше 100000',
      }),
    )
    renderPage()

    await pick(user, 'OC-90')
    await pick(user, 'BP-1')
    await user.click(postButton())

    await waitFor(() => expect(fieldErrorOf(qtyInput('BP-1'))).toBe('Должно быть не больше 100000'))
    expect(fieldErrorOf(qtyInput('OC-90'))).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a business error above the button', async () => {
    const user = userEvent.setup()
    mockSearch()
    vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(409, 'Товар OC-90 в архиве'))
    renderPage()

    await pick(user, 'OC-90')
    await user.click(postButton())

    expect((await screen.findByRole('alert')).textContent).toBe('Товар OC-90 в архиве')
  })

  it('asks before leaving with lines that are not posted', async () => {
    const user = userEvent.setup()
    mockSearch()
    const { router } = renderPage()

    await pick(user, 'OC-90')
    await user.click(screen.getByRole('link', { name: '← Приходы' }))

    const dialog = await screen.findByRole('dialog', { name: 'Уйти без проведения?' })
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(router.state.location.pathname).toBe('/receipts/new')

    await user.click(screen.getByRole('link', { name: '← Приходы' }))
    await user.click(await screen.findByRole('button', { name: 'Уйти' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/receipts'))
  })
})
