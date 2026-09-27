import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { notifications } from '@mantine/notifications'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { renderWithProviders } from '../../test/render'
import type { Product } from './api'
import { ProductFormModal } from './ProductFormModal'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    article: 'OC-90',
    article_norm: 'OC90',
    brand: null,
    name: 'Фильтр масляный',
    unit: 'шт',
    sale_price: 1250000,
    note: null,
    is_archived: false,
    created_at: '2026-09-27T09:00:00Z',
    updated_at: '2026-09-27T09:00:00Z',
    stock: 0,
    ...overrides,
  }
}

function mockPost() {
  return vi.spyOn(api, 'POST')
}

// openapi-fetch's response shape; the error middleware throws before callers see non-2xx.
function ok(data: Product) {
  return Promise.resolve({ data, response: new Response() }) as never
}

function renderForm() {
  const onClose = vi.fn()
  renderWithProviders(<ProductFormModal opened onClose={onClose} />)
  return { onClose }
}

function field(label: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: label }) as HTMLInputElement
}

/** Text of the error shown under a field (Mantine links it via aria-describedby). */
function fieldError(label: string): string | null {
  const input = field(label)
  if (input.getAttribute('aria-invalid') !== 'true') return null
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? []
  const errorId = ids.find((id) => id.endsWith('-error'))
  return errorId ? (document.getElementById(errorId)?.textContent ?? null) : null
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProductFormModal', () => {
  it('does not send the form with empty required fields', async () => {
    const user = userEvent.setup()
    const post = mockPost()
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(post).not.toHaveBeenCalled()
    expect(fieldError('Артикул')).toBe('Введите артикул')
    expect(fieldError('Наименование')).toBe('Введите наименование')
  })

  it('sends the price in tiyn and submits on Enter', async () => {
    const user = userEvent.setup()
    const post = mockPost().mockReturnValue(ok(product()))
    const { onClose } = renderForm()

    await user.type(field('Артикул'), ' OC-90 ')
    await user.type(field('Наименование'), 'Фильтр масляный')
    await user.type(field('Цена'), '12 500{Enter}')

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith('/api/products', {
      body: {
        article: 'OC-90',
        name: 'Фильтр масляный',
        sale_price: 1250000,
        unit: 'шт',
        brand: null,
        note: null,
      },
    })
  })

  it('shows server field errors under their fields', async () => {
    const user = userEvent.setup()
    mockPost().mockRejectedValue(
      new ApiError(422, 'Проверьте введённые данные', { name: 'Максимальная длина: 255' }),
    )
    renderForm()

    await user.type(field('Артикул'), 'OC-90')
    await user.type(field('Наименование'), 'Фильтр')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fieldError('Наименование')).toBe('Максимальная длина: 255'))
    expect(fieldError('Артикул')).toBeNull()
  })

  it('shows a duplicate article (409) under the article field', async () => {
    const user = userEvent.setup()
    const message = 'Товар с артикулом «OC-90» уже есть: Фильтр масляный'
    mockPost().mockRejectedValue(new ApiError(409, message))
    const { onClose } = renderForm()

    await user.type(field('Артикул'), 'ос-90')
    await user.type(field('Наименование'), 'Фильтр')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fieldError('Артикул')).toBe(message))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Сохранить и добавить ещё" clears the form and focuses the article', async () => {
    const user = userEvent.setup()
    const post = mockPost().mockReturnValue(ok(product({ article: 'OC-90' })))
    const notify = vi.spyOn(notifications, 'show')
    const { onClose } = renderForm()

    await user.type(field('Артикул'), 'OC-90')
    await user.type(field('Наименование'), 'Фильтр масляный')
    await user.type(field('Цена'), '12500')
    await user.click(screen.getByRole('button', { name: 'Сохранить и добавить ещё' }))

    await waitFor(() => expect(field('Артикул').value).toBe(''))
    expect(post).toHaveBeenCalledTimes(1)
    expect(field('Наименование').value).toBe('')
    expect(field('Цена').value).toBe('')
    expect(field('Единица').value).toBe('шт')
    expect(document.activeElement).toBe(field('Артикул'))
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Товар OC-90 добавлен' }),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
