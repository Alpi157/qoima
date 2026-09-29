import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { makeProduct, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import { StockPage } from './StockPage'

const IN_STOCK = makeProduct({ id: 1, article: 'IKH16TT', name: 'Свеча', stock: 12 })
const EMPTY = makeProduct({ id: 2, article: 'L3Y4', name: 'Свеча Mazda', stock: 0 })

interface ListInit {
  params: { query: { q?: string } }
}

function renderStock(route = '/stock') {
  return renderWithDataRouter(
    [
      { path: '/stock', element: <StockPage /> },
      { path: '/products/:id', element: <h1>Карточка</h1> },
    ],
    { route },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StockPage', () => {
  it('shows the stock, and «Нет» in red when nothing is left', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [IN_STOCK, EMPTY], total: 2 }))
    renderStock()

    expect(await screen.findByRole('heading', { name: 'Что есть на складе?' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Принять товар' }).getAttribute('href')).toBe(
      '/receive',
    )
    expect((await screen.findAllByText('12 шт')).length).toBeGreaterThan(0)
    const none = screen.getAllByText('Нет')[0]
    expect(none.getAttribute('style') ?? '').toContain('--mantine-color-red')
  })

  it('searches by the typed text and keeps it in the address', async () => {
    const user = setupUser()
    const get = vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [IN_STOCK], total: 1 }))
    const { router } = renderStock()

    await fill(
      user,
      await screen.findByRole('searchbox', { name: 'Поиск по артикулу или названию' }),
      'ikh',
    )
    await waitFor(() => expect(router.state.location.search).toBe('?q=ikh'))
    const queries = () =>
      get.mock.calls.map((call) => (call[1] as unknown as ListInit).params.query.q)
    await waitFor(() => expect(queries()).toContain('ikh'))
  })

  it('a row opens the product card', async () => {
    const user = setupUser()
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [IN_STOCK], total: 1 }))
    const { router } = renderStock()

    await user.click((await screen.findAllByText('Свеча'))[0])
    expect(router.state.location.pathname).toBe('/products/1')
  })
})
