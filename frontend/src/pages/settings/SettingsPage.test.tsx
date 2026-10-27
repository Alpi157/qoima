import { notifications } from '@mantine/notifications'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { fieldErrorOf } from '../../test/fields'
import { fieldError, makeBusinessSettings, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import type { BusinessSettingsUpdate } from './api'
import { SettingsPage } from './SettingsPage'

const IIN_BIN_ERROR = 'ИИН/БИН должен состоять из 12 цифр'

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
  it('saves VAT and the rate threshold in the same request as invoice details', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(makeBusinessSettings()))
    const put = vi
      .spyOn(api, 'PUT')
      .mockReturnValue(ok(makeBusinessSettings({ is_vat_payer: true, rate_warning_percent: 15 })))
    renderWithProviders(<SettingsPage />)
    const user = setupUser()
    await user.click(await screen.findByRole('checkbox', { name: 'Мы плательщик НДС' }))
    const threshold = screen.getByRole('textbox', { name: 'Предупреждать о разнице курса, %' })
    await user.clear(threshold)
    await fill(user, threshold, '15')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect((put.mock.calls[0][1] as { body: BusinessSettingsUpdate }).body).toMatchObject({
      is_vat_payer: true,
      rate_warning_percent: 15,
      seller_name: '3А Аuto Parts.KZ',
    })
  })
  it('rejects rate thresholds outside 1–100 without losing the entered value', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(makeBusinessSettings()))
    const put = vi.spyOn(api, 'PUT')
    renderWithProviders(<SettingsPage />)
    const user = setupUser()
    const field = await screen.findByRole('textbox', { name: 'Предупреждать о разнице курса, %' })
    await user.clear(field)
    await fill(user, field, '101')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(put).not.toHaveBeenCalled()
    expect((field as HTMLInputElement).value).toBe('101')
    expect(screen.getByText('Введите целое число от 1 до 100.')).toBeTruthy()
  })
  it('«Нет бухгалтера» writes the phrase for the invoice', async () => {
    const user = setupUser()
    vi.spyOn(api, 'GET').mockReturnValue(ok(makeBusinessSettings({ chief_accountant: 'Иванова' })))
    const put = vi.spyOn(api, 'PUT').mockReturnValue(ok(makeBusinessSettings()))
    renderWithProviders(<SettingsPage />)

    const accountant = 'Главный бухгалтер (расшифровка подписи)'
    await screen.findByLabelText(accountant)
    await user.click(screen.getByRole('button', { name: 'Нет бухгалтера' }))
    expect(field(accountant).value).toBe('Қамтамасыз етілмейді')

    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    const [, init] = put.mock.calls[0] as unknown as [string, { body: BusinessSettingsUpdate }]
    expect(init.body.chief_accountant).toBe('Қамтамасыз етілмейді')
  })

  it('saves trimmed values and confirms', async () => {
    const user = setupUser()
    vi.spyOn(api, 'GET').mockReturnValue(ok(EMPTY))
    const saved = makeBusinessSettings()
    const put = vi.spyOn(api, 'PUT').mockReturnValue(ok(saved))
    const notify = vi.spyOn(notifications, 'show')
    renderWithProviders(<SettingsPage />)

    await fill(user, await screen.findByLabelText(SELLER), ' 3А Аuto Parts.KZ ')
    await fill(user, field('ИИН/БИН'), '900101300123')
    await fill(user, field('Ответственный за поставку (Ф.И.О.)'), 'Кәкеш Арман')
    await fill(user, field('Отпустил (расшифровка подписи)'), 'Кәкеш А.')
    await fill(user, field('Главный бухгалтер (расшифровка подписи)'), 'Қамтамасыз етілмейді')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    const [path, init] = put.mock.calls[0] as unknown as [string, { body: BusinessSettingsUpdate }]
    expect(path).toBe('/api/settings')
    expect(init.body).toStrictEqual({
      card_commission_percent: '0',
      tax_percent: '0',
      is_vat_payer: false,
      rate_warning_percent: 10,
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
    const user = setupUser()
    vi.spyOn(api, 'GET').mockReturnValue(ok(EMPTY))
    const put = vi.spyOn(api, 'PUT')
    renderWithProviders(<SettingsPage />)

    await fill(user, await screen.findByLabelText('ИИН/БИН'), '12345')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(fieldErrorOf(field('ИИН/БИН'))).toBe(IIN_BIN_ERROR)
    expect(put).not.toHaveBeenCalled()
  })

  it('shows the server error under the ИИН/БИН field', async () => {
    const user = setupUser()
    vi.spyOn(api, 'GET').mockReturnValue(ok(EMPTY))
    vi.spyOn(api, 'PUT').mockRejectedValue(
      new ApiError(
        422,
        'Проверьте введённые данные',
        { seller_iin_bin: fieldError('ИИН/БИН должен состоять из 12 цифр', 'iin_bin_format') },
        'validation_error',
      ),
    )
    renderWithProviders(<SettingsPage />)

    await fill(user, await screen.findByLabelText('ИИН/БИН'), '900101300123')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(fieldErrorOf(field('ИИН/БИН'))).toBe('ИИН/БИН должен состоять из 12 цифр'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

it('accepts a decimal comma for percentages and preserves invalid text', async () => {
  vi.spyOn(api, 'GET').mockReturnValue(ok(makeBusinessSettings()))
  const put = vi
    .spyOn(api, 'PUT')
    .mockReturnValue(
      ok(makeBusinessSettings({ card_commission_percent: '0.95', tax_percent: '3.5' })),
    )
  renderWithProviders(<SettingsPage />)
  const user = setupUser()
  const commission = await screen.findByRole('textbox', {
    name: 'Комиссия за оплату картой и QR, %',
  })
  const tax = screen.getByRole('textbox', { name: 'Налог, % от выручки' })
  await user.clear(commission)
  await fill(user, commission, '0,95')
  await user.clear(tax)
  await fill(user, tax, '1.234')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(put).not.toHaveBeenCalled()
  expect(
    (screen.getByRole('textbox', { name: 'Налог, % от выручки' }) as HTMLInputElement).value,
  ).toBe('1.234')
  expect(
    screen.getByText('Введите число от 0 до 100, не больше двух знаков после запятой.'),
  ).toBeTruthy()
  await user.clear(screen.getByRole('textbox', { name: 'Налог, % от выручки' }))
  await fill(user, screen.getByRole('textbox', { name: 'Налог, % от выручки' }), '3,5')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect((put.mock.calls[0][1] as { body: BusinessSettingsUpdate }).body).toMatchObject({
    card_commission_percent: '0.95',
    tax_percent: '3.5',
  })
})
