import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import 'dayjs/locale/ru'

import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { router } from './router'

dayjs.locale('ru')

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="light">
      <DatesProvider settings={{ locale: 'ru' }}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
)
