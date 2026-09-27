import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { makeCustomer, ok } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { CustomerPicker, type CustomerPickerProps, type PickedCustomer } from './CustomerPicker'

const YERZHAN = makeCustomer({ id: 1, name: 'Ержан', phone: '+7 701 111 22 33' })
const AIDOS = makeCustomer({ id: 2, name: 'Айдос', phone: null })

/** Keeps the chosen customer like a page does, and reports every change. */
function Harness({
  onChange,
  ...props
}: Omit<CustomerPickerProps, 'value' | 'onChange'> & { onChange: (c: unknown) => void }) {
  const [value, setValue] = useState<PickedCustomer | null>(null)
  return (
    <CustomerPicker
      {...props}
      value={value}
      onChange={(customer) => {
        setValue(customer)
        onChange(customer)
      }}
    />
  )
}

function search(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Покупатель' }) as HTMLInputElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CustomerPicker', () => {
  it('searches by name or phone, picks with arrows and Enter, shows a plate to reset', async () => {
    const user = userEvent.setup()
    const get = vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [YERZHAN, AIDOS], total: 2 }))
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)

    await user.type(search(), '701')
    await screen.findByText('Айдос')
    expect(screen.getByText('+7 701 111 22 33')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/api/customers', {
      params: { query: { q: '701', limit: 10 } },
    })
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenLastCalledWith(AIDOS)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByText('Айдос')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Сбросить покупателя' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(document.activeElement).toBe(search())
  })

  it('creates a customer from the typed name and selects it', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [], total: 0 }))
    const created = makeCustomer({ id: 5, name: 'Болат', phone: null })
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(created))
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)

    await user.type(search(), 'Болат')
    await user.click(await screen.findByText('Создать покупателя «Болат»'))

    const name = screen.getByRole('textbox', { name: 'Имя' }) as HTMLInputElement
    expect(name.value).toBe('Болат')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created))
    expect(post).toHaveBeenCalledWith('/api/customers', {
      body: { name: 'Болат', phone: null, note: null },
    })
    expect(screen.getByRole('button', { name: 'Сбросить покупателя' })).toBeTruthy()
  })

  it('does not offer creation when it is turned off', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok({ items: [], total: 0 }))
    renderWithProviders(<Harness onChange={vi.fn()} allowCreate={false} />)

    await user.type(search(), 'Болат')

    expect(await screen.findByText('Не найдено')).toBeTruthy()
    expect(screen.queryByText(/Создать покупателя/)).toBeNull()
  })
})
