import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import '@fontsource/fira-sans/400.css'
import '@fontsource/fira-sans/500.css'
import '@fontsource/fira-sans/600.css'
import '@fontsource/fira-sans/700.css'
import './styles/fonts.css'
import './styles/global.css'
import './styles/tables.css'
import './i18n'

import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { setUnauthorizedHandler } from './api/client'
import { queryClient } from './api/queryClient'
import { LocalizedDates } from './components/LocalizedDates'
import { PageLoader } from './components/PageLoader'
import { LOGIN_PATH, loginPathFor } from './lib/nextPath'
import { router } from './router'
import { cssVariablesResolver, theme } from './theme'

setUnauthorizedHandler(() => {
  const { pathname, search } = router.state.location
  // The login page itself checks the session; a 401 there is expected.
  if (pathname === LOGIN_PATH) return
  queryClient.clear()
  void router.navigate(loginPathFor(pathname, search), { replace: true })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="light"
    >
      <Notifications position="top-right" />
      <LocalizedDates>
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={<PageLoader fullScreen />}>
            <RouterProvider router={router} />
          </Suspense>
        </QueryClientProvider>
      </LocalizedDates>
    </MantineProvider>
  </StrictMode>,
)
