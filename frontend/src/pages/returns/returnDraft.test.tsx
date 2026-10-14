import { screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { networkError } from '../../api/errors'
import { makeCustomer, makeReturn, makeSale, ok } from '../../test/fixtures'
import { postBody } from '../../test/flowApi'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { ReturnCreate } from './api'
import { ReturnCreatePage } from './ReturnCreatePage'
import { returnDraftKey } from './returnDraft'

afterEach(() => vi.restoreAllMocks())
it('restores a complete unknown return and retries the same body after all goods were returned', async () => {
  const sale = makeSale({
    customer: null,
    total: 10000,
    lines: [
      {
        id: 11,
        product_id: 1,
        article: 'OC-90',
        name: 'Filter',
        unit: 'шт',
        qty: 1,
        returned_qty: 0,
        unit_price: 10000,
        line_total: 10000,
        unit_cost: 5000,
      },
    ],
  })
  let accepted = false
  vi.spyOn(api, 'GET').mockImplementation(((path: string) =>
    path === '/api/auth/me'
      ? ok({ id: 1 })
      : path === '/api/sales/{sale_id}'
        ? ok({
            ...sale,
            lines: sale.lines.map((line) => ({ ...line, returned_qty: accepted ? line.qty : 0 })),
          })
        : ok(makeCustomer())) as never)
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValueOnce(networkError())
    .mockReturnValueOnce(ok(makeReturn()))
  const mount = () =>
    renderWithDataRouter(
      [
        { path: '/sales/:id/return', element: <ReturnCreatePage /> },
        { path: '/returns/:id', element: <p>Saved</p> },
      ],
      { route: `/sales/${sale.id}/return` },
    )
  const first = mount()
  const user = setupUser()
  await fill(
    user,
    await screen.findByRole('textbox', { name: `Количество ${sale.lines[0].article}` }),
    String(sale.lines[0].qty),
  )
  await user.click(screen.getByRole('button', { name: 'Сохранить возврат' }))
  await screen.findByTestId('unknown-result')
  const body = postBody<ReturnCreate>(post)
  expect(sessionStorage.getItem(returnDraftKey(1, sale.id))).not.toBeNull()
  accepted = true
  first.unmount()
  mount()
  await screen.findByTestId('unknown-result')
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await screen.findByText('Saved')
  expect(postBody<ReturnCreate>(post, 1)).toEqual(body)
  expect(sessionStorage.getItem(returnDraftKey(1, sale.id))).toBeNull()
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
})
