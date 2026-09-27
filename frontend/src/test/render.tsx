import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { theme } from '../theme'

export interface RenderOptions {
  /** Initial address, for example "/login?next=/products". */
  route?: string
}

/** Renders with Mantine (no portals or transitions), a fresh QueryClient and a router. */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/' }: RenderOptions = {},
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MantineProvider theme={theme} env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}
