import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, withDocumentTimeout } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import { SellPage } from '../../pages/sell/SellPage'
import { ReceivePage } from '../../pages/receive/ReceivePage'
import { createSaleDraft, type SaleDraft } from '../../pages/sell/saleDraft'
import { createReceiptDraft } from '../../pages/receive/receiptDraft'
import { mockFlowGet, postBody } from '../../test/flowApi'
import { makeProduct, makeReceipt, makeSale, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import { draftKey } from './useDraft'

const product = makeProduct({ stock: 10 })
const second = makeProduct({ id: 2, article: 'SECOND', stock: 10 })

function seed(flow: 'sale' | 'receipt', review = false) {
  const key = draftKey(1, flow)
  const draft =
    flow === 'sale'
      ? {
          ...createSaleDraft(),
          customer: 'none',
          lines: [{ productId: 1, article: product.article, qty: 1, price: '100' }],
        }
      : {
          ...createReceiptDraft(),
          lines: [{ productId: 1, article: product.article, qty: 1, cost: '50' }],
        }
  localStorage.setItem(key, JSON.stringify(draft))
  const route = flow === 'sale' ? `/sell${review ? '?step=3' : ''}` : '/receive'
  const mount = () =>
    renderWithDataRouter(
      [
        { path: '/sell', element: <SellPage /> },
        { path: '/receive', element: <ReceivePage /> },
        { path: '/sell/done/:id', element: <p>Done</p> },
        { path: '/receive/done/:id', element: <p>Done</p> },
        { path: '/sales/:id', element: <p>Saved document</p> },
      ],
      { route },
    )
  return { key, draft, mount }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('draft product safety', () => {
  it.each([0, 401, 502])(
    'keeps both visible lines after product status %s and reloads them',
    async (status) => {
      const get = mockFlowGet({ products: [product, second] })
      const normal = get.getMockImplementation()! as unknown as (
        path: string,
        init: unknown,
      ) => unknown
      let unavailable = true
      get.mockImplementation(((path: string, init: unknown) =>
        path === '/api/products/{product_id}' && unavailable
          ? Promise.reject(new ApiError(status, 'Unavailable'))
          : normal(path, init)) as never)
      const { key, draft, mount } = seed('sale')
      localStorage.setItem(
        key,
        JSON.stringify({
          ...draft,
          lines: [...draft.lines, { productId: 2, article: second.article, qty: 2, price: '100' }],
        }),
      )
      mount()
      await screen.findByTestId('line-load-error')
      expect(screen.getAllByTestId('flow-line')).toHaveLength(2)
      expect(screen.queryByText('Пока товаров нет. Найдите выше и нажмите «Добавить».')).toBeNull()
      expect(screen.getByTestId('sale-total').textContent).toBe('—')
      expect(JSON.parse(localStorage.getItem(key)!).lines).toHaveLength(2)
      expect(
        screen.getByRole('button', { name: 'Далее: покупатель' }).hasAttribute('disabled'),
      ).toBe(true)
      unavailable = false
      await setupUser().click(screen.getByRole('button', { name: 'Повторить' }))
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Далее: покупатель' }).hasAttribute('disabled'),
        ).toBe(false),
      )
      expect(JSON.parse(localStorage.getItem(key)!).requestId).toBe(draft.requestId)
    },
  )
  it.each(['sale', 'receipt'] as const)(
    'drops only 404 and archived lines once in %s',
    async (flow) => {
      mockFlowGet({ products: [second, { ...product, is_archived: true }] })
      const { key, draft, mount } = seed(flow)
      localStorage.setItem(
        key,
        JSON.stringify({
          ...draft,
          lines: [
            draft.lines[0],
            { productId: 99, article: 'DELETED', qty: 1, price: '100', cost: '50' },
            { productId: 2, article: second.article, qty: 1, price: '100', cost: '50' },
          ],
        }),
      )
      mount()
      const notice = await screen.findByTestId('removed-products')
      await waitFor(() => expect(notice.textContent).toContain('DELETED'))
      expect(notice.textContent).toContain(product.article)
      expect(screen.getAllByTestId('removed-products')).toHaveLength(1)
      expect(JSON.parse(localStorage.getItem(key)!).lines).toHaveLength(1)
    },
  )
  it('cannot save a sale from only the successfully loaded subset', async () => {
    const get = mockFlowGet({ products: [product] })
    const normal = get.getMockImplementation()! as unknown as (
      path: string,
      init: unknown,
    ) => unknown
    get.mockImplementation(((
      path: string,
      init: { params?: { path?: { product_id?: number } } },
    ) =>
      path === '/api/products/{product_id}' && init.params?.path?.product_id === 2
        ? Promise.reject(networkError())
        : normal(path, init)) as never)
    const post = vi.spyOn(api, 'POST')
    const { key, draft, mount } = seed('sale', true)
    localStorage.setItem(
      key,
      JSON.stringify({
        ...draft,
        lines: [...draft.lines, { productId: 2, article: 'SECOND', qty: 1, price: '100' }],
      }),
    )
    mount()
    await screen.findByTestId('line-load-error')
    const save = await screen.findByRole('button', { name: 'Сохранить продажу' })
    expect(save.hasAttribute('disabled')).toBe(true)
    await setupUser().click(save)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('unknown document result', () => {
  for (const flow of ['sale', 'receipt'] as const) {
    it.each([networkError(), new ApiError(502, 'Gateway'), new ApiError(503, 'Unavailable')])(
      `${flow}: persists unknown, reuses the current draft and clears after success (%s)`,
      async (failure) => {
        mockFlowGet({ products: [product] })
        const post = vi
          .spyOn(api, 'POST')
          .mockRejectedValueOnce(failure)
          .mockReturnValueOnce(ok(flow === 'sale' ? makeSale() : makeReceipt()))
        const { key, draft, mount } = seed(flow, true)
        const first = mount()
        const user = setupUser()
        const save = await screen.findByRole('button', {
          name: flow === 'sale' ? 'Сохранить продажу' : 'Добавить на склад',
        })
        await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false))
        await user.click(save)
        await screen.findByTestId('unknown-result')
        expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
          requestId: draft.requestId,
          unknown: true,
        })
        first.unmount()
        const secondMount = mount()
        const result = await screen.findByTestId('unknown-result')
        await waitFor(() =>
          expect(within(result).getByRole('button').hasAttribute('disabled')).toBe(false),
        )
        await user.click(within(result).getByRole('button'))
        await screen.findByText('Done')
        expect(postBody<{ request_id: string }>(post, 1).request_id).toBe(draft.requestId)
        expect(localStorage.getItem(key)).toBeNull()
        await act(() => secondMount.router.navigate(flow === 'sale' ? '/sell' : '/receive'))
        await user.type(await screen.findByRole('searchbox'), product.article)
        await user.keyboard('{Enter}')
        await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull())
        expect(JSON.parse(localStorage.getItem(key)!).requestId).not.toBe(draft.requestId)
      },
    )
    it(`${flow}: 422 remains an ordinary refusal`, async () => {
      mockFlowGet({ products: [product] })
      vi.spyOn(api, 'POST').mockRejectedValue(new ApiError(422, 'Fix this'))
      const { key, draft, mount } = seed(flow, true)
      mount()
      const save = await screen.findByRole('button', {
        name: flow === 'sale' ? 'Сохранить продажу' : 'Добавить на склад',
      })
      await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false))
      await setupUser().click(save)
      await screen.findByText('Fix this')
      expect(screen.queryByTestId('unknown-result')).toBeNull()
      expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
        requestId: draft.requestId,
        unknown: false,
      })
    })
  }
  it('edits an unknown sale and keeps its key, including an empty draft after all lines are removed', async () => {
    mockFlowGet({ products: [product] })
    const { key, draft, mount } = seed('sale')
    localStorage.setItem(key, JSON.stringify({ ...draft, unknown: true }))
    const first = mount()
    const user = setupUser()
    await user.click(await screen.findByRole('button', { name: `Убрать ${product.article}` }))
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      requestId: draft.requestId,
      unknown: true,
      lines: [],
    })
    first.unmount()
    mount()
    expect(await screen.findByTestId('unknown-result')).toBeTruthy()
    expect((JSON.parse(localStorage.getItem(key)!) as SaleDraft).requestId).toBe(draft.requestId)
  })
})

it('aborts a pending document at 30 seconds and releases the deadline after success', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const result = withDocumentTimeout((value) => {
    signal = value
    return new Promise((_, reject) =>
      value.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
    )
  }).catch((error) => error as ApiError)
  await vi.advanceTimersByTimeAsync(29999)
  expect(signal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(signal?.aborted).toBe(true)
  expect(await result).toMatchObject({ status: 0 })
  await expect(withDocumentTimeout(async () => 'saved')).resolves.toBe('saved')
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['sale', 'receipt'] as const)(
  '%s shows unknown after a pending POST is aborted by its deadline',
  async (flow) => {
    mockFlowGet({ products: [product] })
    const timers = vi.spyOn(window, 'setTimeout')
    const post = vi
      .spyOn(api, 'POST')
      .mockImplementation(
        ((_path: string, init: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          )) as never,
      )
    const { key, draft, mount } = seed(flow, true)
    mount()
    const save = await screen.findByRole('button', {
      name: flow === 'sale' ? 'Сохранить продажу' : 'Добавить на склад',
    })
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false))
    await setupUser().click(save)
    const deadline = timers.mock.calls.find(([, delay]) => delay === 30000)![0] as () => void
    await act(async () => {
      deadline()
    })
    await screen.findByTestId('unknown-result')
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      requestId: draft.requestId,
      unknown: true,
    })
    expect(postBody<{ request_id: string }>(post).request_id).toBe(draft.requestId)
  },
)
