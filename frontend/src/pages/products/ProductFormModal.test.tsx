import { screen, waitFor } from '@testing-library/react'
import { notifications } from '@mantine/notifications'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { renderWithProviders } from '../../test/render'
import { fieldError as apiFieldError, makeProduct, ok } from '../../test/fixtures'
import { fill, setupUser } from '../../test/user'
import type { Product } from './api'
import { ProductFormModal } from './ProductFormModal'

const PRICE_REQUIRED = 'Укажите цену'

const product = makeProduct

function mockPost() {
  return vi.spyOn(api, 'POST')
}

function mockPatch() {
  return vi.spyOn(api, 'PATCH')
}

function renderForm(props: { product?: Product } = {}) {
  const onClose = vi.fn()
  renderWithProviders(<ProductFormModal opened onClose={onClose} {...props} />)
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

/** The unit Select: a combobox, not a textbox. */
function unitField(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Единица' }) as HTMLInputElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProductFormModal', () => {
  it('does not send the form with empty required fields', async () => {
    const user = setupUser()
    const post = mockPost()
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(post).not.toHaveBeenCalled()
    expect(fieldError('Артикул')).toBe('Введите артикул')
    expect(fieldError('Наименование')).toBe('Введите наименование')
  })

  it('sends the price in tiyn and submits on Enter', async () => {
    const user = setupUser()
    const post = mockPost().mockReturnValue(ok(product()))
    const { onClose } = renderForm()

    await fill(user, field('Артикул'), ' OC-90 ')
    await fill(user, field('Наименование'), 'Фильтр масляный')
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
    const user = setupUser()
    mockPost().mockRejectedValue(
      new ApiError(422, 'Проверьте введённые данные', {
        name: apiFieldError('Максимальная длина: 255', 'string_too_long', { max_length: 255 }),
      }),
    )
    renderForm()

    await fill(user, field('Артикул'), 'OC-90')
    await fill(user, field('Наименование'), 'Фильтр')
    await user.type(field('Цена'), '100')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fieldError('Наименование')).toBe('Максимальная длина: 255'))
    expect(fieldError('Артикул')).toBeNull()
  })

  it('shows a duplicate article (409) under the article field', async () => {
    const user = setupUser()
    const message = 'Товар с артикулом «OC-90» уже есть: Фильтр масляный'
    mockPost().mockRejectedValue(new ApiError(409, message))
    const { onClose } = renderForm()

    await fill(user, field('Артикул'), 'ос-90')
    await fill(user, field('Наименование'), 'Фильтр')
    await user.type(field('Цена'), '100')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fieldError('Артикул')).toBe(message))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Сохранить и добавить ещё" clears the form and focuses the article', async () => {
    const user = setupUser()
    const post = mockPost().mockReturnValue(ok(product({ article: 'OC-90' })))
    const notify = vi.spyOn(notifications, 'show')
    const { onClose } = renderForm()

    await fill(user, field('Артикул'), 'OC-90')
    await fill(user, field('Наименование'), 'Фильтр масляный')
    await fill(user, field('Цена'), '12500')
    await user.click(screen.getByRole('button', { name: 'Сохранить и добавить ещё' }))

    await waitFor(() => expect(field('Артикул').value).toBe(''))
    expect(post).toHaveBeenCalledTimes(1)
    expect(field('Наименование').value).toBe('')
    expect(field('Цена').value).toBe('')
    expect(unitField().value).toBe('шт')
    expect(document.activeElement).toBe(field('Артикул'))
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Товар OC-90 добавлен' }),
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not send an empty price', async () => {
    const user = setupUser()
    const post = mockPost()
    renderForm()

    await fill(user, field('Артикул'), 'OC-90')
    await fill(user, field('Наименование'), 'Фильтр')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(post).not.toHaveBeenCalled()
    expect(fieldError('Цена')).toBe(PRICE_REQUIRED)
  })

  it('sends an explicit zero price', async () => {
    const user = setupUser()
    const post = mockPost().mockReturnValue(ok(product({ sale_price: 0 })))
    const { onClose } = renderForm()

    await fill(user, field('Артикул'), 'OC-90')
    await fill(user, field('Наименование'), 'Фильтр')
    await user.type(field('Цена'), '0')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith(
      '/api/products',
      expect.objectContaining({ body: expect.objectContaining({ sale_price: 0 }) }),
    )
  })

  it('keeps a unit that is not in the list when editing', async () => {
    const user = setupUser()
    const saved = product({ unit: 'бухта' })
    const patch = mockPatch().mockReturnValue(ok(saved))
    const { onClose } = renderForm({ product: saved })

    expect(unitField().value).toBe('бухта')
    await user.clear(field('Наименование'))
    await fill(user, field('Наименование'), 'Провод')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(patch).toHaveBeenCalledWith('/api/products/{product_id}', {
      params: { path: { product_id: 1 } },
      body: expect.objectContaining({ name: 'Провод', unit: 'бухта' }),
    })
  })
})
