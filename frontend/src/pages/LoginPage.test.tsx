import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { ApiError } from '../api/errors'
import { LANGUAGE_STORAGE_KEY } from '../i18n/language'
import { onlyKazakh } from '../test/i18n'
import { renderWithProviders } from '../test/render'
import { LoginPage } from './LoginPage'

function renderLogin(route: string) {
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/products" element={<p>Страница товаров</p>} />
      <Route path="/sale" element={<p>Страница продажи</p>} />
    </Routes>,
    { route },
  )
}

function mockLoggedIn() {
  vi.spyOn(api, 'GET').mockResolvedValue({
    data: { id: 1, username: 'owner', full_name: 'Владелец', role: 'owner', locale: 'kk' },
    response: new Response(),
  } as never)
}

function mockLoggedOut() {
  vi.spyOn(api, 'GET').mockRejectedValue(new ApiError(401, 'Требуется вход'))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoginPage', () => {
  it('sends a logged-in user to the "next" page', async () => {
    mockLoggedIn()
    renderLogin('/login?next=%2Fproducts')
    expect(await screen.findByText('Страница товаров')).toBeTruthy()
  })

  it('sends a logged-in user to the sale page when "next" is unsafe', async () => {
    mockLoggedIn()
    renderLogin('/login?next=%2F%2Fevil.example')
    expect(await screen.findByText('Страница продажи')).toBeTruthy()
  })

  it('shows the texts of the current language', async () => {
    mockLoggedOut()
    await onlyKazakh({ auth: { login: { submit: 'Кіру', username: 'Логин (kk)' } } })
    renderLogin('/login')

    expect(await screen.findByRole('button', { name: 'Кіру' })).toBeTruthy()
    expect(screen.getByLabelText('Логин (kk)')).toBeTruthy()
    // Missing in Kazakh: the Russian text.
    expect(screen.getByLabelText('Пароль')).toBeTruthy()
  })

  it('switches the language before login without saving it on the server', async () => {
    const user = userEvent.setup()
    mockLoggedOut()
    const patch = vi.spyOn(api, 'PATCH')
    renderLogin('/login')

    await user.click(await screen.findByRole('button', { name: '中文' }))

    expect(i18n.language).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh')
    expect(screen.getByRole('button', { name: '中文' }).getAttribute('aria-pressed')).toBe('true')
    expect(patch).not.toHaveBeenCalled()
  })
})
