import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import { draftKey } from '../../components/flow'
import { makeProduct, makeReceipt, ok } from '../../test/fixtures'
import { mockFlowGet, postBody } from '../../test/flowApi'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { ProductCreate } from '../products/api'
import type { ReceiptCreate } from '../receipts/api'
import { ReceiveDonePage } from './ReceiveDonePage'
import { ReceivePage } from './ReceivePage'
import { createReceiptDraft, type ReceiptDraft } from './receiptDraft'

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
    ...createReceiptDraft(),
    requestId: crypto.randomUUID(),
    lines: [{ productId: 1, priceCurrency: 'KZT', qty: 3, cost: '' }],
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
  it('marks empty costs in lines and focuses the first without opening extras', async () => {
    const user = setupUser()
    const second = makeProduct({ id: 2, article: 'W712' })
    mockFlowGet({ products: [FILTER, second] })
    const post = vi.spyOn(api, 'POST')
    saveDraft({
      lines: [
        { productId: 1, priceCurrency: 'KZT', qty: 3, cost: '' },
        { productId: 2, priceCurrency: 'KZT', qty: 1, cost: '' },
      ],
    })
    renderReceive()
    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    expect(screen.getByRole('textbox', { name: 'Закупочная цена OC-90' })).toBeTruthy()
    await user.click(submitButton())
    const input = await screen.findByRole('textbox', { name: 'Закупочная цена OC-90' })
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByText('Укажите закупочную цену')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'Дополнительно' }).getAttribute('aria-expanded'),
    ).toBe('false')
    expect(post).not.toHaveBeenCalled()
    await fill(user, input, '0')
    expect(input.getAttribute('aria-invalid')).not.toBe('true')
    await user.click(submitButton())
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Закупочная цена W712' }),
      ),
    )
    expect(post).not.toHaveBeenCalled()
  })

  it('accepts an explicit zero purchase price from a restored draft', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReceipt()))
    saveDraft({ lines: [{ productId: 1, priceCurrency: 'KZT', qty: 3, cost: '0' }] })
    renderReceive()
    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(submitButton())
    expect(postBody<ReceiptCreate>(post).lines).toEqual([
      { product_id: 1, qty: 3, unit_price_minor: 0 },
    ])
  })

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
    const catalog = [FILTER]
    mockFlowGet({ products: catalog })
    const created = makeProduct({ id: 30, article: 'PE5R', name: 'Свеча Mazda', stock: 0 })
    const post = vi.spyOn(api, 'POST').mockImplementation(() => {
      catalog.push(created)
      return ok(created)
    })
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
    expect(storedDraft()?.lines).toMatchObject([
      { productId: 30, priceCurrency: 'KZT', qty: 1, cost: '' },
    ])
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

  it('a saved purchase price is sent even with extras collapsed', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReceipt({ id: 5 })))
    saveDraft({ lines: [{ productId: 1, priceCurrency: 'KZT', qty: 3, cost: '900' }] })
    const { router } = renderReceive()

    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(submitButton())

    expect(post.mock.calls[0][0]).toBe('/api/receipts')
    const body = postBody<ReceiptCreate>(post)
    expect(body).toEqual({
      currency: 'KZT',
      confirmed_warnings: [],
      request_id: expect.any(String),
      supplier: null,
      note: null,
      lines: [{ product_id: 1, qty: 3, unit_price_minor: 90000 }],
    })
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
      currency: 'KZT',
      confirmed_warnings: [],
      request_id: expect.any(String),
      supplier: 'Начальные остатки',
      note: null,
      lines: [{ product_id: 1, qty: 3, unit_price_minor: 90000 }],
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
  it('hides the restored notice after changing a line and retains the draft', async () => {
    const user = setupUser()
    mockFlowGet({ products: [FILTER] })
    saveDraft({})
    renderReceive()
    expect(await screen.findByText('Незавершённый приём восстановлен.')).toBeTruthy()
    await screen.findByRole('textbox', { name: 'Количество OC-90' })
    await user.click(screen.getByRole('button', { name: 'Увеличить' }))
    expect(screen.queryByText('Незавершённый приём восстановлен.')).toBeNull()
    expect(storedDraft()?.lines[0].qty).toBe(4)
  })
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
          {
            product_id: 1,
            article: 'OC-90',
            name: 'Фильтр',
            unit: 'шт',
            qty: 3,
            unit_cost: null,
            unit_price_minor: null,
            goods_total: null,
            expenses_total: 0,
            vat_credit_total: 0,
          },
          {
            product_id: 2,
            article: 'W712',
            name: 'Фильтр',
            unit: 'шт',
            qty: 4,
            unit_cost: null,
            unit_price_minor: null,
            goods_total: null,
            expenses_total: 0,
            vat_credit_total: 0,
          },
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

describe('receiving costs in lines', () => {
  it.each([90050, 0, null])(
    'prefills last_cost %s only when adding a new line',
    async (last_cost) => {
      const user = setupUser()
      mockFlowGet({
        products: [
          makeProduct({
            ...FILTER,
            last_cost,
            last_purchase_currency: last_cost === null ? null : 'KZT',
            last_purchase_price_minor: last_cost,
          }),
        ],
      })
      renderReceive()
      const search = await screen.findByRole('searchbox')
      await fill(user, search, 'OC')
      await user.keyboard('{Enter}')
      const cost = await screen.findByRole('textbox', { name: 'Закупочная цена OC-90' })
      expect((cost as HTMLInputElement).value).toBe(
        last_cost === null ? '' : last_cost === 0 ? '0' : '900,50',
      )
      await user.clear(cost)
      await fill(user, cost, '700')
      await fill(user, search, 'OC')
      await user.keyboard('{Enter}')
      await waitFor(() =>
        expect(storedDraft()?.lines[0]).toMatchObject({
          productId: 1,
          priceCurrency: 'KZT',
          qty: 2,
          cost: '700',
        }),
      )
    },
  )

  it.each(['12500', '13000'])(
    'warns for purchase price %s without blocking saving',
    async (cost) => {
      const user = setupUser()
      mockFlowGet({ products: [FILTER] })
      saveDraft({ lines: [{ productId: 1, priceCurrency: 'KZT', qty: 2, cost }] })
      const post = vi.spyOn(api, 'POST').mockReturnValue(ok(makeReceipt()))
      renderReceive()
      const warning = await screen.findByText(/Не дороже ли цены продажи/)
      const salePrice = screen.getByText(/^Цена продажи:/)
      expect(salePrice.textContent).not.toContain('Не дороже')
      expect(warning.tagName).toBe('P')
      expect(salePrice.tagName).toBe('P')
      expect(salePrice.nextElementSibling).toBe(warning)
      expect(warning.getAttribute('style')).toContain('--q-color-warning-text')
      expect(submitButton().disabled).toBe(false)
      await user.click(submitButton())
      expect(post).toHaveBeenCalled()
    },
  )

  it('shows purchase sums and restores old lines without cost without substituting last_cost', async () => {
    mockFlowGet({
      products: [
        makeProduct({ ...FILTER, last_cost: 50000 }),
        makeProduct({ id: 2, article: 'W712' }),
      ],
    })
    localStorage.setItem(
      RECEIPT_KEY,
      JSON.stringify({
        version: 1,
        lines: [
          { productId: 1, priceCurrency: 'KZT', qty: 2, cost: '900,50' },
          { productId: 2, priceCurrency: 'KZT', qty: 3 },
        ],
      }),
    )
    renderReceive()
    expect(
      ((await screen.findByRole('textbox', { name: 'Закупочная цена W712' })) as HTMLInputElement)
        .value,
    ).toBe('')
    const lines = screen.getAllByTestId('flow-line')
    expect(lines[0].textContent).toContain('1\u00a0801\u00a0₸')
    expect(screen.getByTestId('receipt-total').textContent).toBe('Сумма: 1\u00a0801\u00a0₸')
  })
})

it('adds all valid line costs to the purchase total in integer tiyn', async () => {
  mockFlowGet({ products: [FILTER, makeProduct({ id: 2, article: 'W712' })] })
  saveDraft({
    lines: [
      { productId: 1, priceCurrency: 'KZT', qty: 2, cost: '900,50' },
      { productId: 2, priceCurrency: 'KZT', qty: 3, cost: '700' },
    ],
  })
  renderReceive()
  await screen.findByRole('textbox', { name: 'Закупочная цена W712' })
  expect(screen.getByTestId('receipt-total').textContent).toBe('Сумма: 3\u00a0901\u00a0₸')
})

it('upgrades an old draft and keeps its key through network errors and reload', async () => {
  const user = setupUser()
  mockFlowGet({ products: [FILTER] })
  const old = {
    version: 1,
    lines: [{ productId: 1, priceCurrency: 'KZT', qty: 3, cost: '900' }],
    supplier: 'Supplier',
    note: '',
    receivedAt: null,
    extrasOpen: false,
  }
  localStorage.setItem(RECEIPT_KEY, JSON.stringify(old))
  const post = vi.spyOn(api, 'POST').mockRejectedValue(networkError())
  const rendered = renderReceive()
  await screen.findByRole('textbox', { name: 'Количество OC-90' })
  const migrated = storedDraft()!
  expect(migrated).toMatchObject({ ...old, version: 3, requestId: expect.any(String) })
  await user.click(submitButton())
  await screen.findByTestId('unknown-result')
  expect(postBody<ReceiptCreate>(post).request_id).toBe(migrated.requestId)
  expect(storedDraft()?.requestId).toBe(migrated.requestId)
  rendered.unmount()
  renderReceive()
  await screen.findByRole('textbox', { name: 'Количество OC-90' })
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await screen.findByTestId('unknown-result')
  expect(postBody<ReceiptCreate>(post, 1).request_id).toBe(migrated.requestId)
})

it('starts with a new key after a successful receipt', async () => {
  const user = setupUser()
  mockFlowGet({ products: [FILTER] })
  saveDraft({ lines: [{ productId: 1, priceCurrency: 'KZT', qty: 3, cost: '900' }] })
  const originalKey = storedDraft()!.requestId
  vi.spyOn(api, 'POST').mockReturnValue(ok(makeReceipt()))
  const { router } = renderReceive()
  await screen.findByRole('textbox', { name: 'Количество OC-90' })
  await user.click(submitButton())
  await waitFor(() => expect(router.state.location.pathname).toBe('/receive/done/5'))
  expect(storedDraft()).toBeNull()
  await act(() => router.navigate('/receive'))
  await fill(user, await screen.findByRole('searchbox'), 'OC')
  await user.keyboard('{Enter}')
  await screen.findByRole('textbox', { name: 'Количество OC-90' })
  expect(storedDraft()?.requestId).not.toBe(originalKey)
  expect(storedDraft()?.requestId).toMatch(/^[a-f0-9-]{36}$/)
})

it('shows the receipt conflict without clearing the draft', async () => {
  const user = setupUser()
  mockFlowGet({ products: [FILTER] })
  saveDraft({ lines: [{ productId: 1, priceCurrency: 'KZT', qty: 3, cost: '900' }] })
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError(409, 'detail', {}, 'receipt_request_conflict', { id: 5, number: 42 }),
  )
  renderReceive()
  await screen.findByRole('textbox', { name: 'Количество OC-90' })
  await user.click(submitButton())
  expect((await screen.findByRole('alert')).textContent).toContain('№42')
  expect(storedDraft()?.lines).toHaveLength(1)
})
