import { screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../test/render'
import { setupUser } from '../../test/user'
import { QtyStepper } from './QtyStepper'

describe('QtyStepper', () => {
  it('disables decrement at one and allows it at two', async () => {
    const user = setupUser()
    const onChange = vi.fn()
    function Harness() {
      const [value, setValue] = useState(1)
      return (
        <QtyStepper
          value={value}
          onChange={(next) => {
            onChange(next)
            setValue(Number(next))
          }}
          label="Количество"
          unit="шт."
        />
      )
    }
    renderWithProviders(<Harness />)
    const decrease = screen.getByRole('button', { name: 'Уменьшить' }) as HTMLButtonElement
    expect(decrease.disabled).toBe(true)
    await user.click(decrease)
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Увеличить' }))
    expect(decrease.disabled).toBe(false)
    await user.click(decrease)
    expect(onChange).toHaveBeenCalledWith(1)
  })
})
