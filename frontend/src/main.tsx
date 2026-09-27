import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import 'dayjs/locale/ru'

import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { Notifications } from '@mantine/notifications'
import { QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { setUnauthorizedHandler } from './api/client'
import { queryClient } from './api/queryClient'
import { LOGIN_PATH, loginPathFor } from './lib/nextPath'
import { router } from './router'
import { theme } from './theme'

dayjs.locale('ru')

setUnauthorizedHandler(() => {
  const { pathname, search } = router.state.location
  // The login page itself checks the session; a 401 there is expected.
  if (pathname === LOGIN_PATH) return
  queryClient.clear()
  void router.navigate(loginPathFor(pathname, search), { replace: true })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <DatesProvider settings={{ locale: 'ru' }}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
)
