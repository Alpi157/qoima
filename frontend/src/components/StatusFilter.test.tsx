import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../test/render'
import { setupUser } from '../test/user'
import { StatusFilter } from './StatusFilter'

const OPTIONS = [
  { value: '', label: 'Барлығы' },
  { value: 'posted', label: 'Сақталғандар' },
  { value: 'cancelled', label: 'Күші жойылғандар' },
]

describe('StatusFilter', () => {
  it('fills the chosen button and outlines the others', async () => {
    const user = setupUser()
    const onChange = vi.fn()
    renderWithProviders(
      <StatusFilter label="Күйі" options={OPTIONS} value="posted" onChange={onChange} />,
    )

    const group = screen.getByRole('group', { name: 'Күйі' })
    const chosen = screen.getByRole('button', { name: 'Сақталғандар' })
    expect(group.contains(chosen)).toBe(true)
    expect(chosen.getAttribute('aria-pressed')).toBe('true')
    expect(chosen.getAttribute('data-variant')).toBe('filled')
    const other = screen.getByRole('button', { name: 'Күші жойылғандар' })
    expect(other.getAttribute('aria-pressed')).toBe('false')
    expect(other.getAttribute('data-variant')).toBe('default')
    expect(other.getAttribute('data-size')).toBe('sm')

    await user.click(other)
    expect(onChange).toHaveBeenCalledWith('cancelled')
  })
})
