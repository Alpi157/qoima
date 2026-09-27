import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { makeProduct, ok } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { ProductPicker } from './ProductPicker'

const FILTER = makeProduct({ id: 1, article: 'OC-90', name: 'Фильтр масляный' })
const PADS = makeProduct({ id: 2, article: 'OC-91', name: 'Фильтр воздушный' })

function search(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Поиск товара' }) as HTMLInputElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProductPicker', () => {
  it('searches by the typed text and picks with arrows and Enter', async () => {
    const user = userEvent.setup()
    const get = vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [FILTER, PADS], total: 2 }))
    const onSelect = vi.fn()
    renderWithProviders(<ProductPicker onSelect={onSelect} autoFocus />)

    expect(document.activeElement).toBe(search())
    await user.type(search(), 'oc9')
    await screen.findByText('Фильтр воздушный')
    expect(get).toHaveBeenCalledWith('/api/products', {
      params: { query: { q: 'oc9', limit: 10 } },
    })

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).toHaveBeenCalledWith(PADS)
    expect(search().value).toBe('')
  })

  it('Enter picks the first result right away', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [FILTER, PADS], total: 2 }))
    const onSelect = vi.fn()
    renderWithProviders(<ProductPicker onSelect={onSelect} />)

    await user.type(search(), 'oc')
    await screen.findByText('Фильтр масляный')
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(FILTER)
  })

  it('Esc closes the list', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [FILTER], total: 1 }))
    renderWithProviders(<ProductPicker onSelect={vi.fn()} />)

    await user.type(search(), 'oc')
    await screen.findByText('Фильтр масляный')
    expect(search().hasAttribute('data-expanded')).toBe(true)
    await user.keyboard('{Escape}')

    // The dropdown stays in the DOM hidden; the input loses its "expanded" mark.
    await waitFor(() => expect(search().hasAttribute('data-expanded')).toBe(false))
  })

  it('offers to create a product when nothing is found', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [], total: 0 }))
    const created = makeProduct({ id: 7, article: 'BP-1', name: 'Колодки' })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(created))
    const onSelect = vi.fn()
    renderWithProviders(<ProductPicker onSelect={onSelect} />)

    await user.type(search(), 'BP-1')
    await user.click(await screen.findByText('Создать товар «BP-1»'))

    const article = screen.getByRole('textbox', { name: 'Артикул' }) as HTMLInputElement
    expect(article.value).toBe('BP-1')
    expect(screen.queryByRole('button', { name: 'Сохранить и добавить ещё' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Наименование' }), 'Колодки')
    await user.type(screen.getByRole('textbox', { name: 'Цена' }), '5000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(created))
    expect(post).toHaveBeenCalledWith(
      '/api/products',
      expect.objectContaining({ body: expect.objectContaining({ article: 'BP-1' }) }),
    )
    expect(search().value).toBe('')
  })
})
