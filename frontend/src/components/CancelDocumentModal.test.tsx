import { useMutation } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../test/render'
import { fill, setupUser } from '../test/user'
import { CancelDocumentModal } from './CancelDocumentModal'

function Harness({ cancel }: { cancel: (reason: string) => Promise<string> }) {
  const mutation = useMutation({ mutationFn: cancel })
  return (
    <CancelDocumentModal
      opened
      onClose={() => {}}
      title="Отменить продажу №21?"
      description="Товар вернётся на склад."
      confirmLabel="Отменить продажу"
      cancel={mutation}
      successMessage={() => 'Отменена'}
    />
  )
}

describe('CancelDocumentModal', () => {
  it('a quick reason fills the field in one press, the text can still be edited', async () => {
    const user = setupUser()
    const cancel = vi.fn().mockResolvedValue('ok')
    renderWithProviders(<Harness cancel={cancel} />)

    const reason = screen.getByRole('textbox', { name: 'Причина' }) as HTMLTextAreaElement
    const quick = screen.getByRole('group', { name: 'Быстрый выбор причины' })
    expect([...quick.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Ошибка ввода',
      'Покупатель отказался',
      'Товар возвращён',
    ])

    await user.click(screen.getByRole('button', { name: 'Покупатель отказался' }))
    expect(reason.value).toBe('Покупатель отказался')

    await user.click(screen.getByRole('button', { name: 'Ошибка ввода' }))
    expect(reason.value).toBe('Ошибка ввода')

    await fill(user, reason, ': цена')
    expect(reason.value).toBe('Ошибка ввода: цена')

    await user.click(screen.getByRole('button', { name: 'Отменить продажу' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    expect(cancel.mock.calls[0][0]).toBe('Ошибка ввода: цена')
  })
})
