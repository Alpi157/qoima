import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { draftKey } from '../../components/flow'
import { makeProduct, makeReceipt, ok } from '../../test/fixtures'
import { mockFlowGet, postBody } from '../../test/flowApi'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { ProductCreate } from '../products/api'
import type { ReceiptCreate } from '../receipts/api'
import { ReceiveDonePage } from './ReceiveDonePage'
import { ReceivePage } from './ReceivePage'
import type { ReceiptDraft } from './receiptDraft'

const FILTER = makeProduct({ id: 1, article: 'OC-90', name: 'Фильтр масляный', stock: 5 })
const RECEIPT_KEY = draftKey(1, 'receipt')

function renderReceive(route = '/receive') {
  return renderWithDataRouter(
    [
      { path: '/receive', element: <ReceivePage /> },
      { path: '/receive/done/:id', element: <ReceiveDonePage /> },
      { path: '/', element: <h1>Главная</h1> },
    ],
    { route },
  )
}

function saveDraft(draft: Partial<ReceiptDraft>, key = RECEIPT_KEY) {
  const full: ReceiptDraft = {
    version: 1,
    lines: [{ productId: 1, qty: 3, cost: '' }],
    supplier: '',
    note: '',
    receivedAt: null,
    extrasOpen: false,
    ...draft,
  }
  localStorage.setItem(key, JSON.stringify(full))
}

function storedDraft(key = RECEIPT_KEY): ReceiptDraft | null {
  const text = localStorage.getItem(key)
  return text === null ? null : (JSON.parse(text) as ReceiptDraft)
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Добавить на склад' }) as HTMLButtonElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReceivePage', () => {
  it('shows the stock before and after the receiving under a line', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    renderReceive()

    await fill(user, await screen.findByRole('searchbox'), 'OC')
    expect(await screen.findByText('Сейчас на складе: 5 шт')).toBeTruthy()
    await user.keyboard('{Enter}')

    expect(await screen.findByText('Сейчас: 5 шт. После приёма: 6 шт.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Увеличить' }))
    expect(screen.getByText('Сейчас: 5 шт. После приёма: 7 шт.')).toBeTruthy()
  })

  it('a product that is not found is created on the spot and becomes a line', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    const created = makeProduct({ id: 30, article: 'PE5R', name: 'Свеча Mazda', stock: 0 })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(created))
    renderReceive()

    await fill(user, await screen.findByRole('searchbox'), 'PE5R')
    expect(await screen.findByText('«PE5R» на складе ещё нет.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Добавить как новый товар' }))

    const form = screen.getByTestId('new-product-form')
    expect((within(form).getByRole('textbox', { name: 'Артикул' }) as HTMLInputElement).value).toBe(
      'PE5R',
    )
    await fill(user, within(form).getByRole('textbox', { name: 'Название' }), 'Свеча Mazda')
    await fill(user, within(form).getByRole('textbox', { name: 'Цена продажи, ₸' }), '1400')
    await user.click(within(form).getByRole('button', { name: 'Сохранить и добавить' }))

    expect(post.mock.calls[0][0]).toBe('/api/products')
    expect(postBody<ProductCreate>(post)).toEqual({
      article: 'PE5R',
      name: 'Свеча Mazda',
      sale_price: 140000,
      unit: 'шт',
    })
    expect(await screen.findByRole('textbox', { name: 'Количество PE5R' })).toBeTruthy()
    expect(screen.queryByTestId('new-product-form')).toBeNull()
    expect(storedDraft()?.lines).toEqual([{ productId: 30, qty: 1, cost: '' }])
  })

  it('an existing article in the new product form is shown under the field', async () => {
    const user = setupUser()
    mockFlowGet({ products: [] })
    vi.spyOn(api, 'POST').mockRejectedValue(
      new ApiError(409, 'Товар с таким артикулом уже есть', {}, 'duplicate_article'),
    )
    renderReceive()

    await fill(user, await screen.findByRole('searchbox'), 'OC-90')
    await user.click(await screen.findByRole('button', { name: 'Добавить как новый товар' }))
    const form = screen.getByTestId('new-product-form')
    await fill(user, within(form).getByRole('textbox', { name: 'Название' }), 'Фильтр')
    await fill(user, within(form).getByRole('textbox', { name: 'Цена продажи, ₸' }), '100')
    await user.click(within(form).getByRole('button', { name: 'Сохранить и добавить' }))

    const article = within(form).getByRole('textbox', { name: 'Артикул' })
    await waitFor(() => expect(article.getAttribute('aria-invalid')).toBe('true'))
  })

  it('without «Дополнительно» sends no date, supplier or costs and opens the done screen', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReceipt({ id: 5 })))
    saveDraft({})
    const { router } = renderReceive()

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(submitButton())

    expect(post.mock.calls[0][0]).toBe('/api/receipts')
    const body = postBody<ReceiptCreate>(post)
    expect(body).toEqual({ supplier: null, note: null, lines: [{ product_id: 1, qty: 3 }] })
    expect('received_at' in body).toBe(false)
    await waitFor(() => expect(router.state.location.pathname).toBe('/receive/done/5'))
    expect(storedDraft()).toBeNull()
  })

  it('«Дополнительно» sends the supplier and the purchase prices', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReceipt({ id: 5 })))
    saveDraft({})
    renderReceive()

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    const toggle = screen.getByRole('button', { name: 'Дополнительно' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Начальные остатки' }))
    expect((screen.getByRole('textbox', { name: 'Поставщик' }) as HTMLInputElement).value).toBe(
      'Начальные остатки',
    )
    await fill(user, screen.getByRole('textbox', { name: 'Закупочная цена OC-90' }), '900')
    await user.click(submitButton())

    expect(postBody<ReceiptCreate>(post)).toEqual({
      supplier: 'Начальные остатки',
      note: null,
      lines: [{ product_id: 1, qty: 3, unit_cost: 90000 }],
    })
  })

  it('an empty quantity blocks the button and says what to fix', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    saveDraft({})
    renderReceive()

    const qty = await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.clear(qty)
    expect(screen.getByText('Укажите количество.')).toBeTruthy()
    expect(submitButton().disabled).toBe(true)
    expect(screen.getByText('Исправьте товары, отмеченные оранжевым.')).toBeTruthy()
  })
})

describe('ReceivePage, draft', () => {
  it('is restored with a notice and cleared with «Очистить»', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    saveDraft({ supplier: 'Автоимпорт' })
    renderReceive()

    expect(await screen.findByText('Незавершённый приём восстановлен.')).toBeTruthy()
    expect(await screen.findByRole('textbox', { name: 'Количество OC-90' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(storedDraft()).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Количество OC-90' })).toBeNull()
  })

  it('«Отмена» with lines asks first, then deletes the draft', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    saveDraft({})
    const { router } = renderReceive()

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Да, отменить' }),
    )
    expect(storedDraft()).toBeNull()
    expect(router.state.location.pathname).toBe('/')
  })

  it('another user does not see this draft', async () => {
    mockFlowGet({ products: [FILTER], userId: 2 })
    saveDraft({})
    renderReceive()

    expect(await screen.findByText(/Товаров пока нет/)).toBeTruthy()
    expect(screen.queryByText('Незавершённый приём восстановлен.')).toBeNull()
  })
})

describe('ReceiveDonePage', () => {
  it('shows how much came in and where to go next', async () => {
    mockFlowGet({
      receipt: makeReceipt({
        id: 5,
        lines: [
          { product_id: 1, article: 'OC-90', name: 'Фильтр', qty: 3, unit_cost: null },
          { product_id: 2, article: 'W712', name: 'Фильтр', qty: 4, unit_cost: null },
        ],
        total_qty: 7,
      }),
    })
    renderReceive('/receive/done/5')

    expect(await screen.findByRole('heading', { name: 'Товар добавлен на склад' })).toBeTruthy()
    expect(screen.getByText('Видов товара: 2, всего 7 шт.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Принять ещё товар' }).getAttribute('href')).toBe(
      '/receive',
    )
    expect(screen.getByRole('link', { name: 'Что есть на складе?' }).getAttribute('href')).toBe(
      '/stock',
    )
  })
})
