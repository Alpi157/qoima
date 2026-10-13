import { screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { reloadPage } from '../lib/browserReload'

import { api } from '../api/client'
import { AppLayout } from '../layout/AppLayout'
import { PageModuleError } from '../lib/pageReload'
import { renderWithDataRouter } from '../test/render'
import { ok } from '../test/fixtures'
import { setupUser } from '../test/user'
import { RouteErrorPage } from './RouteErrorPage'

vi.mock('../lib/browserReload', () => ({ reloadPage: vi.fn() }))

function Broken({ error }: { error: Error }): never {
  throw error
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RouteErrorPage', () => {
  it.each(['kk', 'ru', 'zh'])(
    'shows both variants in %s and reloads on click',
    async (language) => {
      await i18n.changeLanguage(language)
      const reload = vi.mocked(reloadPage).mockReset()
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      for (const moduleError of [true, false]) {
        const error = moduleError
          ? new PageModuleError(new Error('private details'))
          : new Error('private details')
        const view = renderWithDataRouter([
          { path: '/', element: <Broken error={error} />, errorElement: <RouteErrorPage /> },
        ])
        expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty(
          'textContent',
          i18n.t(moduleError ? 'common.routeError.moduleTitle' : 'common.routeError.title'),
        )
        expect(
          screen.getByText(
            i18n.t(
              moduleError ? 'common.routeError.moduleDescription' : 'common.routeError.description',
            ),
          ),
        ).toBeTruthy()
        expect(screen.queryByText(/private details/)).toBeNull()
        expect(
          screen.getByRole('link', { name: i18n.t('common.notFound.toHome') }).getAttribute('href'),
        ).toBe('/')
        await setupUser().click(
          screen.getByRole('button', { name: i18n.t('common.routeError.reload') }),
        )
        expect(log).toHaveBeenCalledWith(error)
        view.unmount()
      }
      expect(reload).toHaveBeenCalledTimes(2)
    },
  )

  it('keeps the layout header when its child fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(api, 'GET').mockReturnValue(ok({ id: 1, locale: 'ru', full_name: 'Owner' }))
    renderWithDataRouter(
      [
        {
          element: <AppLayout />,
          children: [
            {
              path: '/report',
              element: <Broken error={new PageModuleError('missing')} />,
              errorElement: <RouteErrorPage />,
            },
          ],
        },
      ],
      { route: '/report' },
    )
    expect(await screen.findByRole('heading', { name: 'Программа обновилась' })).toBeTruthy()
    expect(within(screen.getByRole('banner')).getByText('Qoima')).toBeTruthy()
  })
})
