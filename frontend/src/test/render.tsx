import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import {
  createMemoryRouter,
  MemoryRouter,
  type RouteObject,
  RouterProvider,
} from 'react-router-dom'

import { theme } from '../theme'

export interface RenderOptions {
  /** Initial address, for example "/login?next=/products". */
  route?: string
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

/** Renders with Mantine (no portals or transitions), a fresh QueryClient and a router. */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/' }: RenderOptions = {},
): RenderResult {
  return render(
    <MantineProvider theme={theme} env="test">
      <QueryClientProvider client={testQueryClient()}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

/**
 * Same providers with a data router, for pages that use useBlocker or navigate between routes.
 * Returns the router to inspect `router.state.location`.
 */
export function renderWithDataRouter(routes: RouteObject[], { route = '/' }: RenderOptions = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const result = render(
    <MantineProvider theme={theme} env="test">
      <QueryClientProvider client={testQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  )
  return { ...result, router }
}
