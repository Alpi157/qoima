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

function renderApp() {
  return renderWithDataRouter(
    [
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [{ path: '/sale', element: <p>Экран продажи</p> }],
          },
        ],
      },
    ],
    { route: '/sale' },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('language after login', () => {
  it("comes from the user's locale", async () => {
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('zh')))
    renderApp()

    await screen.findByText('Экран продажи')
    await waitFor(() => expect(i18n.language).toBe('zh'))
    expect(document.documentElement.lang).toBe('zh')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh')
  })

  it('is saved on the server when switched in the header', async () => {
    const clicker = userEvent.setup()
    vi.spyOn(api, 'GET').mockReturnValue(ok(user('ru')))
    const patch = vi.spyOn(api, 'PATCH').mockReturnValue(ok(user('kk')))
    renderApp()
    await screen.findByText('Экран продажи')

    // The header and the phone menu both have the switcher; the header one comes first.
    await clicker.click(screen.getAllByRole('button', { name: 'Қазақша' })[0])

    expect(i18n.language).toBe('kk')
    expect(document.documentElement.lang).toBe('kk')
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/auth/me', { body: { locale: 'kk' } }),
    )
    // The menu follows the language.
    expect(screen.getByRole('link', { name: 'Сатылымдар' })).toBeTruthy()
  })
})
