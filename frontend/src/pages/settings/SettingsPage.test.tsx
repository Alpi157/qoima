import { notifications } from '@mantine/notifications'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { fieldErrorOf } from '../../test/fields'
import { makeBusinessSettings, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import type { BusinessSettingsUpdate } from './api'
import { IIN_BIN_ERROR, SettingsPage } from './SettingsPage'

const EMPTY = makeBusinessSettings({
  seller_name: '',
  seller_iin_bin: '',
  responsible_person: '',
  released_by_name: '',
  chief_accountant: '',
})

const SELLER = 'Организация (индивидуальный предприниматель)'

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SettingsPage', () => {
  it('saves trimmed values and confirms', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(EMPTY))
    const saved = makeBusinessSettings()
    const put = vi.spyOn(api, 'PUT').mockReturnValue(ok(saved))
    const notify = vi.spyOn(notifications, 'show')
    renderWithProviders(<SettingsPage />)

    await user.type(await screen.findByLabelText(SELLER), ' 3А Аuto Parts.KZ ')
    await user.type(field('ИИН/БИН'), '900101300123')
    await user.type(field('Ответственный за поставку (Ф.И.О.)'), 'Кәкеш Арман')
    await user.type(field('Отпустил (расшифровка подписи)'), 'Кәкеш А.')
    await user.type(field('Главный бухгалтер (расшифровка подписи)'), 'Қамтамасыз етілмейді')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    const [path, init] = put.mock.calls[0] as unknown as [string, { body: BusinessSettingsUpdate }]
    expect(path).toBe('/api/settings')
    expect(init.body).toStrictEqual({
      seller_name: '3А Аuto Parts.KZ',
      seller_iin_bin: '900101300123',
      responsible_person: 'Кәкеш Арман',
      released_by_name: 'Кәкеш А.',
      chief_accountant: 'Қамтамасыз етілмейді',
    })
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Настройки сохранены' }),
      ),
    )
    expect(field(SELLER).value).toBe('3А Аuto Parts.KZ')
  })

  it('shows the stored values', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(makeBusinessSettings()))
    renderWithProviders(<SettingsPage />)

    expect(((await screen.findByLabelText('ИИН/БИН')) as HTMLInputElement).value).toBe(
      '900101300123',
    )
    expect(field('Главный бухгалтер (расшифровка подписи)').value).toBe('Қамтамасыз етілмейді')
  })

  it('checks the ИИН/БИН before sending', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(EMPTY))
    const put = vi.spyOn(api, 'PUT')
    renderWithProviders(<SettingsPage />)

    await user.type(await screen.findByLabelText('ИИН/БИН'), '12345')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(fieldErrorOf(field('ИИН/БИН'))).toBe(IIN_BIN_ERROR)
    expect(put).not.toHaveBeenCalled()
  })

  it('shows the server error under the ИИН/БИН field', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(EMPTY))
    vi.spyOn(api, 'PUT').mockRejectedValue(
      new ApiError(
        422,
        'Проверьте введённые данные',
        { seller_iin_bin: 'ИИН/БИН должен состоять из 12 цифр' },
        'validation_error',
      ),
    )
    renderWithProviders(<SettingsPage />)

    await user.type(await screen.findByLabelText('ИИН/БИН'), '900101300123')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(fieldErrorOf(field('ИИН/БИН'))).toBe('ИИН/БИН должен состоять из 12 цифр'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
