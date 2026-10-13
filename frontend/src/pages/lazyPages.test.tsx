import { Suspense, type ComponentType } from 'react'
import { act, screen } from '@testing-library/react'
import { useRouteError } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reloadPage } from '../lib/browserReload'

import { renderWithDataRouter } from '../test/render'

const NOW = 1_800_000_000_000
vi.mock('../lib/browserReload', () => ({ reloadPage: vi.fn() }))
const reload = vi.mocked(reloadPage)

beforeEach(() => {
  vi.resetModules()
  window.sessionStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  reload.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderPage(Page: ComponentType) {
  const onError = vi.fn()
  function ErrorBoundary() {
    onError(useRouteError())
    return <p>Localized error</p>
  }
  return {
    ...renderWithDataRouter([
      {
        path: '/',
        element: (
          <Suspense fallback="Loading">
            <Page />
          </Suspense>
        ),
        errorElement: <ErrorBoundary />,
      },
    ]),
    onError,
  }
}

describe('lazyPage', () => {
  it('reloads once and stores the time before reloading', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { PAGE_RELOAD_KEY, PageModuleError } = await import('../lib/pageReload')
    const cause = new TypeError('Failed to fetch dynamically imported module')
    reload.mockImplementation(() => {
      expect(window.sessionStorage.getItem(PAGE_RELOAD_KEY)).toBe(String(NOW))
    })
    const Page = lazyPage(() => Promise.reject(cause))
    const { onError } = renderPage(Page)
    expect(await screen.findByText('Localized error')).toBeTruthy()
    expect(onError).toHaveBeenCalledWith(expect.any(PageModuleError))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ cause }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('passes a repeated error within 30 seconds to the route boundary', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { PAGE_RELOAD_KEY, PageModuleError } = await import('../lib/pageReload')
    window.sessionStorage.setItem(PAGE_RELOAD_KEY, String(NOW - 29_999))
    const cause = new Error('module unavailable')
    const Page = lazyPage(() => Promise.reject(cause))
    const { onError } = renderPage(Page)
    expect(await screen.findByText('Localized error')).toBeTruthy()
    expect(onError).toHaveBeenCalledWith(expect.any(PageModuleError))
    expect(reload).not.toHaveBeenCalled()
  })

  it('allows another reload at 30 seconds', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { PAGE_RELOAD_KEY } = await import('../lib/pageReload')
    window.sessionStorage.setItem(PAGE_RELOAD_KEY, String(NOW - 30_000))
    renderPage(lazyPage(() => Promise.reject(new Error('missing'))))
    expect(await screen.findByText('Localized error')).toBeTruthy()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('clears the mark on success and shares preload with rendering', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { PAGE_RELOAD_KEY } = await import('../lib/pageReload')
    window.sessionStorage.setItem(PAGE_RELOAD_KEY, String(NOW))
    const loader = vi.fn(async () => ({ default: () => <p>Loaded page</p> }))
    const Page = lazyPage(loader)
    await Page.preload()
    expect(window.sessionStorage.getItem(PAGE_RELOAD_KEY)).toBeNull()
    expect(screen.queryByText('Loaded page')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    renderPage(Page)
    expect(await screen.findByText('Loaded page')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('ignores a failed preload without reloading or storing a mark', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { PAGE_RELOAD_KEY } = await import('../lib/pageReload')
    const cause = new TypeError('Failed to fetch dynamically imported module')
    const Page = lazyPage(() => Promise.reject(cause))

    await expect(Page.preload()).resolves.toBeUndefined()

    expect(reload).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(PAGE_RELOAD_KEY)).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(cause)
  })

  it('retries rendering after a failed preload and shows the loaded page', async () => {
    const { lazyPage } = await import('./lazyPages')
    const loader = vi
      .fn<() => Promise<{ default: () => React.JSX.Element }>>()
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValueOnce({ default: () => <p>Loaded page</p> })
    const Page = lazyPage(loader)

    await Page.preload()
    renderPage(Page)

    expect(await screen.findByText('Loaded page')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once when rendering fails after a failed preload', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { PAGE_RELOAD_KEY, PageModuleError } = await import('../lib/pageReload')
    const cause = new Error('module unavailable')
    const loader = vi.fn(() => Promise.reject(cause))
    const Page = lazyPage(loader)

    await Page.preload()
    expect(reload).not.toHaveBeenCalled()
    const { onError } = renderPage(Page)

    expect(await screen.findByText('Localized error')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(PAGE_RELOAD_KEY)).toBe(String(NOW))
    expect(onError).toHaveBeenCalledWith(expect.any(PageModuleError))
  })

  it('handles a background Vite error without the global reload handler', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { handlePreloadError, PAGE_RELOAD_KEY } = await import('../lib/pageReload')
    const background = new Event('vite:preloadError', { cancelable: true })
    const cause = new Error('module unavailable')
    const Page = lazyPage(() => {
      window.dispatchEvent(background)
      return Promise.reject(cause)
    })
    window.addEventListener('vite:preloadError', handlePreloadError)
    try {
      await expect(Page.preload()).resolves.toBeUndefined()
      expect(background.defaultPrevented).toBe(false)
      expect(reload).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(PAGE_RELOAD_KEY)).toBeNull()
      expect(console.warn).toHaveBeenCalledWith(cause)

      const foreground = new Event('vite:preloadError', { cancelable: true })
      window.dispatchEvent(foreground)
      expect(foreground.defaultPrevented).toBe(true)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('vite:preloadError', handlePreloadError)
    }
  })

  it('still reloads when rendering shares a failing background import', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { handlePreloadError, PAGE_RELOAD_KEY } = await import('../lib/pageReload')
    let rejectImport!: (error: Error) => void
    const loader = vi.fn(
      () =>
        new Promise<{ default: () => null }>((_, reject) => {
          rejectImport = reject
        }),
    )
    const Page = lazyPage(loader)
    window.addEventListener('vite:preloadError', handlePreloadError)
    try {
      const preloading = Page.preload()
      renderPage(Page)
      await act(async () => {
        window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
        rejectImport(new Error('module unavailable'))
        await preloading
      })
      expect(await screen.findByText('Localized error')).toBeTruthy()
      expect(loader).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
      expect(window.sessionStorage.getItem(PAGE_RELOAD_KEY)).toBe(String(NOW))
    } finally {
      window.removeEventListener('vite:preloadError', handlePreloadError)
    }
  })

  it.each(['getItem', 'setItem'] as const)(
    'does not reload when storage %s fails',
    async (method) => {
      const { lazyPage } = await import('./lazyPages')
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('Storage blocked', 'SecurityError')
      })
      renderPage(lazyPage(() => Promise.reject(new Error('missing'))))
      expect(await screen.findByText('Localized error')).toBeTruthy()
      expect(reload).not.toHaveBeenCalled()
    },
  )

  it('does not reload when the storage getter is unavailable', async () => {
    const { lazyPage } = await import('./lazyPages')
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
    renderPage(lazyPage(() => Promise.reject(new Error('missing'))))
    expect(await screen.findByText('Localized error')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })

  it('prevents only the first Vite error and avoids a second reload from the loader', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { handlePreloadError } = await import('../lib/pageReload')
    const first = new Event('vite:preloadError', { cancelable: true })
    handlePreloadError(first)
    expect(first.defaultPrevented).toBe(true)
    renderPage(lazyPage(() => Promise.reject(new Error('missing'))))
    expect(await screen.findByText('Localized error')).toBeTruthy()
    const repeated = new Event('vite:preloadError', { cancelable: true })
    handlePreloadError(repeated)
    expect(repeated.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('keeps the mark when Vite suppresses the rejection and returns no module', async () => {
    const { lazyPage } = await import('./lazyPages')
    const { handlePreloadError, PAGE_RELOAD_KEY, PageModuleError } =
      await import('../lib/pageReload')
    handlePreloadError(new Event('vite:preloadError', { cancelable: true }))
    const loader = vi
      .fn<() => Promise<{ default: () => null }>>()
      .mockResolvedValue(undefined as never)
    const { onError } = renderPage(lazyPage(loader))
    expect(await screen.findByText('Localized error')).toBeTruthy()
    expect(onError).toHaveBeenCalledWith(expect.any(PageModuleError))
    expect(window.sessionStorage.getItem(PAGE_RELOAD_KEY)).toBe(String(NOW))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
