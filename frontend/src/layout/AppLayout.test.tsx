import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { CurrentUser } from '../auth/useMe'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { LANGUAGE_STORAGE_KEY } from '../i18n/language'
import { ok } from '../test/fixtures'
import { renderWithDataRouter } from '../test/render'
import { AppLayout } from './AppLayout'

function user(locale: CurrentUser['locale']): CurrentUser {
  return { id: 1, username: 'owner', full_name: 'Владелец', role: 'owner', locale }
}

function renderApp(route = '/products') {
  return renderWithDataRouter(
    [
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: '/', element: <p>Главный экран</p> },
              { path: '/products', element: <p>Экран товаров</p> },
              { path: '/login', element: <p>Вход</p> },
            ],
          },
        ],
      },
    ],
    { route },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('header', () => {
  it('has no «home» button on the main screen', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('ru')))
    renderApp('/')

    await screen.findByText('Главный экран')
    expect(screen.queryByRole('link', { name: 'Главная' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Qoima' }).getAttribute('href')).toBe('/')
  })

  it('has the «home» button on other pages', async () => {
    const clicker = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('ru')))
    const { router } = renderApp('/products')

    await screen.findByText('Экран товаров')
    await clicker.click(screen.getByRole('link', { name: 'Главная' }))

    expect(router.state.location.pathname).toBe('/')
    expect(await screen.findByText('Главный экран')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Главная' })).toBeNull()
  })

  it("shows the user's name and logs out", async () => {
    const clicker = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('ru')))
    const post = vi.spyOn(api, 'POST').mockReturnValue(ok(null))
    const { router } = renderApp()

    await screen.findByText('Экран товаров')
    expect(screen.getByText('Владелец')).toBeTruthy()
    await clicker.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(post).toHaveBeenCalledWith('/api/auth/logout')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('on a narrow screen keeps languages and logout in the menu', async () => {
    const clicker = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('ru')))
    const patch = vi.spyOn(api, 'PATCH').mockReturnValue(ok(user('kk')))
    renderApp()
    await screen.findByText('Экран товаров')

    await clicker.click(screen.getByRole('button', { name: 'Меню' }))
    expect(await screen.findByRole('menuitem', { name: 'Выйти' })).toBeTruthy()
    await clicker.click(screen.getByRole('menuitem', { name: 'Қазақша' }))

    expect(i18n.language).toBe('kk')
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/auth/me', { body: { locale: 'kk' } }),
    )
  })
})

describe('language after login', () => {
  it("comes from the user's locale", async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('zh')))
    renderApp()

    await screen.findByText('Экран товаров')
    await waitFor(() => expect(i18n.language).toBe('zh'))
    expect(document.documentElement.lang).toBe('zh')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh')
  })

  it('is saved on the server when switched in the header', async () => {
    const clicker = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('ru')))
    const patch = vi.spyOn(api, 'PATCH').mockReturnValue(ok(user('kk')))
    renderApp()
    await screen.findByText('Экран товаров')

    await clicker.click(screen.getByRole('button', { name: 'Қазақша' }))

    expect(i18n.language).toBe('kk')
    expect(document.documentElement.lang).toBe('kk')
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/auth/me', { body: { locale: 'kk' } }),
    )
    // The header follows the language.
    expect(screen.getByRole('link', { name: 'Басты бет' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Шығу' })).toBeTruthy()
  })
})
