import { screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../test/render'
import { setupUser } from '../test/user'
import { MoneyInput } from './MoneyInput'

const NBSP = ' '

function Harness({ onTiyn }: { onTiyn: (tiyn: number | null) => void }) {
  const [value, setValue] = useState('')
  return (
    <MoneyInput
      label="Цена"
      value={value}
      onChange={(text, tiyn) => {
        setValue(text)
        onTiyn(tiyn)
      }}
    />
  )
}

const MONEY_INPUT_ERROR = 'Введите сумму, например 12500'

describe('MoneyInput', () => {
  it('turns "12 500" into 1250000 tiyn and shows it formatted', async () => {
    const user = setupUser()
    let lastTiyn: number | null = null
    renderWithProviders(<Harness onTiyn={(tiyn) => (lastTiyn = tiyn)} />)

    const input = screen.getByLabelText('Цена')
    expect(input.getAttribute('inputmode')).toBe('decimal')
    await user.type(input, '12 500')

    expect(lastTiyn).toBe(1250000)
    // The hint uses non-breaking spaces; getByText normalizes them to plain spaces.
    const hint = screen.getByText('12 500 ₸')
    expect(hint.textContent).toBe(`12${NBSP}500${NBSP}₸`)
  })

  it('shows an error for "abc"', async () => {
    const user = setupUser()
    let lastTiyn: number | null = 1
    renderWithProviders(<Harness onTiyn={(tiyn) => (lastTiyn = tiyn)} />)

    await user.type(screen.getByLabelText('Цена'), 'abc')
    await user.tab()

    expect(lastTiyn).toBeNull()
    expect(screen.getByText(MONEY_INPUT_ERROR)).toBeTruthy()
  })
})
